import type { Settings } from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";

export const PROVIDERS: Record<string, { label: string; baseUrl: string; defaultModel: string; keyUrl: string }> = {
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-120b", keyUrl: "https://console.groq.com/keys" },
  nvidia: { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", defaultModel: "meta/llama-3.3-70b-instruct", keyUrl: "https://build.nvidia.com/settings" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini", keyUrl: "https://platform.openai.com/api-keys" },
  custom: { label: "Custom (OpenAI-compatible)", baseUrl: "", defaultModel: "", keyUrl: "" },
};

type Msg = { role: "system" | "user" | "assistant"; content: string };
export interface ChatOpts {
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  imageB64?: string; // optional screenshot (only used by vision-capable builtin)
}

let anthropic: Anthropic | null = null;
function builtin() {
  if (!anthropic) anthropic = new Anthropic({ defaultHeaders: { "anthropic-version": "2023-06-01" } });
  return anthropic;
}

const anthropicAvailable = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * "Looi AI" — the AI engine the server owner pays for, so users never need a key.
 * Tried in order; on rate limits / errors the next one takes over.
 */
interface House { key: string; label: string; baseUrl: string; apiKey: string; model: string; timeoutMs: number }
function houseProviders(): House[] {
  const e = process.env;
  const all: Record<string, House | null> = {
    custom: e.LOOI_AI_BASE_URL && e.LOOI_AI_KEY ? { key: "custom", label: "Looi AI", baseUrl: e.LOOI_AI_BASE_URL, apiKey: e.LOOI_AI_KEY, model: e.LOOI_AI_MODEL || "gpt-4.1-mini", timeoutMs: 90_000 } : null,
    nvidia: e.NVIDIA_API_KEY ? { key: "nvidia", label: "Looi AI (NIM)", baseUrl: e.NVIDIA_BASE_URL || PROVIDERS.nvidia.baseUrl, apiKey: e.NVIDIA_API_KEY, model: e.NVIDIA_MODEL || PROVIDERS.nvidia.defaultModel, timeoutMs: Number(e.LOOI_NIM_TIMEOUT_MS) || 45_000 } : null,
    groq: e.GROQ_API_KEY ? { key: "groq", label: "Looi AI (Groq)", baseUrl: e.GROQ_BASE_URL || PROVIDERS.groq.baseUrl, apiKey: e.GROQ_API_KEY, model: e.GROQ_MODEL || PROVIDERS.groq.defaultModel, timeoutMs: 90_000 } : null,
    openai: e.OPENAI_API_KEY ? { key: "openai", label: "Looi AI (OpenAI)", baseUrl: PROVIDERS.openai.baseUrl, apiKey: e.OPENAI_API_KEY, model: e.OPENAI_MODEL || PROVIDERS.openai.defaultModel, timeoutMs: 90_000 } : null,
  };
  // Default: NVIDIA NIM first, Groq takes over instantly on any NIM error, rate limit, empty reply or timeout.
  const order = (e.LOOI_AI_ORDER || "custom,nvidia,groq,openai").split(",").map((x) => x.trim());
  return order.map((k) => all[k]).filter(Boolean) as House[];
}
/** Circuit breaker: a provider that just failed is skipped for a few minutes so requests go straight to the next one. */
const tripped = new Map<string, number>();
const COOLDOWN_MS = Number(process.env.LOOI_AI_COOLDOWN_MS) || 3 * 60_000;
export function houseStatus() {
  const now = Date.now();
  return houseProviders().map((h) => ({ provider: h.key, model: h.model, healthy: (tripped.get(h.key) || 0) < now }));
}
export function builtinAvailable() {
  return houseProviders().length > 0 || anthropicAvailable();
}
/** Image generation helper only exists in the original dev sandbox. */
export function imageGenAvailable() {
  return anthropicAvailable() && process.env.LOOI_IMAGE_GEN !== "0";
}
async function callHouse(messages: Msg[], o: ChatOpts): Promise<{ text: string; via: string }> {
  let last: unknown;
  const list = houseProviders();
  const now = Date.now();
  // healthy providers first (in order), then tripped ones as a last resort
  const ordered = [...list.filter((h) => (tripped.get(h.key) || 0) < now), ...list.filter((h) => (tripped.get(h.key) || 0) >= now)];
  for (const h of ordered) {
    try {
      const st = { provider: "custom", baseUrl: h.baseUrl, apiKey: h.apiKey, model: h.model } as Settings;
      const text = await callCompatible(st, messages, o, h.timeoutMs);
      if (!text.trim()) throw new Error(`${h.label} returned an empty reply`);
      tripped.delete(h.key);
      return { text, via: h.label };
    } catch (e) {
      last = e;
      tripped.set(h.key, Date.now() + COOLDOWN_MS);
      console.warn(`[looi-ai] ${h.label} failed, switching: ${String((e as any)?.message || e).slice(0, 160)}`);
    }
  }
  if (anthropicAvailable()) return { text: await callBuiltin(messages, o), via: "Looi AI" };
  throw last || new Error("Looi AI is not configured on this server.");
}

async function callCompatible(st: Settings, messages: Msg[], o: ChatOpts, timeoutMs = 120_000) {
  const p = PROVIDERS[st.provider];
  const base = (st.baseUrl || p?.baseUrl || "").replace(/\/$/, "");
  const model = st.model || p?.defaultModel;
  if (!base || !model) throw new Error("AI provider base URL / model not configured");
  const body: any = {
    model,
    messages,
    max_tokens: o.maxTokens ?? 4000,
    temperature: o.temperature ?? 0.7,
  };
  if (o.json) body.response_format = { type: "json_object" };
  const doFetch = async (b: any) =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${st.apiKey}` },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(timeoutMs),
    });
  let res = await doFetch(body);
  if (!res.ok && o.json && res.status === 400) {
    // some providers don't support response_format
    delete body.response_format;
    res = await doFetch(body);
  }
  if (!res.ok) throw new Error(`${p?.label || "Provider"} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  return String(j.choices?.[0]?.message?.content ?? "");
}

async function callBuiltin(messages: Msg[], o: ChatOpts) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const conv: any[] = rest.map((m, i) => {
    if (i === rest.length - 1 && m.role === "user" && o.imageB64) {
      return {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: o.imageB64 } },
          { type: "text", text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
  const sys = (system + (o.json ? "\n\nRespond with ONLY a single valid JSON object. No markdown fences." : "")).trim();
  const r = await builtin().messages.create({
    model: "claude_sonnet_5_5",
    max_tokens: o.maxTokens ?? 4000,
    ...(sys ? { system: sys } : {}),
    ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
    messages: conv,
  });
  return r.content.map((c: any) => (c.type === "text" ? c.text : "")).join("");
}

export async function chat(st: Settings, messages: Msg[], o: ChatOpts = {}): Promise<{ text: string; via: string }> {
  const useUser = st.provider !== "builtin" && !!st.apiKey;
  if (useUser) {
    try {
      return { text: await callCompatible(st, messages, o), via: PROVIDERS[st.provider]?.label || st.provider };
    } catch (e) {
      if (!st.builtinFallback || !builtinAvailable()) throw e;
      const r = await callHouse(messages, o);
      return { text: r.text, via: r.via + " (fallback)" };
    }
  }
  if (st.provider !== "builtin" && !st.apiKey && !st.builtinFallback) throw new Error("No API key set for your AI provider. Add it in Settings → AI engine.");
  if (!builtinAvailable()) throw new Error("No AI provider configured. Add a Groq / NVIDIA NIM / OpenAI-compatible key in Settings (or set GROQ_API_KEY on the server).");
  return callHouse(messages, o);
}

export function parseJson<T = any>(text: string): T {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  // strip reasoning tags some open models emit
  t = t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("AI returned invalid JSON");
  }
}

export async function chatJson<T = any>(st: Settings, system: string, user: string, o: ChatOpts = {}): Promise<{ data: T; via: string }> {
  let lastErr: any;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await chat(st, [{ role: "system", content: system }, { role: "user", content: user }], { ...o, json: true });
      return { data: parseJson<T>(r.text), via: r.via };
    } catch (e) {
      lastErr = e;
      if (String((e as any)?.message || "").match(/40[13]|not configured|No API key|No AI provider/)) break;
    }
  }
  throw lastErr;
}

export async function testProvider(st: Settings) {
  const t = Date.now();
  const r = await chat({ ...st, builtinFallback: false }, [{ role: "user", content: "Reply with exactly: ok" }], { maxTokens: 20, temperature: 0 });
  return { ok: true, reply: r.text.slice(0, 40), via: r.via, ms: Date.now() - t };
}

export async function listModels(st: Settings) {
  const p = PROVIDERS[st.provider];
  const base = (st.baseUrl || p?.baseUrl || "").replace(/\/$/, "");
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${st.apiKey}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  return (j.data || []).map((m: any) => m.id).filter(Boolean).sort();
}
