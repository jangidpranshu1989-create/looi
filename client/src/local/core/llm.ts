import type { HttpFn } from "./http";
import type { Settings } from "./types";

export const PROVIDERS: Record<string, { label: string; baseUrl: string; defaultModel: string; keyUrl: string }> = {
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-120b", keyUrl: "https://console.groq.com/keys" },
  nvidia: { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", defaultModel: "openai/gpt-oss-120b", keyUrl: "https://build.nvidia.com/settings" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini", keyUrl: "https://platform.openai.com/api-keys" },
  custom: { label: "Custom (OpenAI-compatible)", baseUrl: "", defaultModel: "", keyUrl: "" },
};

type Msg = { role: "system" | "user" | "assistant"; content: any };
export interface ChatOpts {
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  imageB64?: string;
}

const VISION = /vision|llama-4|maverick|scout|gpt-4o|gpt-4\.1|gpt-5|gemini|qwen.*vl|pixtral|llava|claude|phi-4-multimodal|gemma-3/i;

export function resolved(st: Settings) {
  const p = PROVIDERS[st.provider];
  return { base: (st.baseUrl || p?.baseUrl || "").replace(/\/$/, ""), model: st.model || p?.defaultModel || "", label: p?.label || st.provider || "AI" };
}

export async function chat(http: HttpFn, st: Settings, messages: Msg[], o: ChatOpts = {}): Promise<{ text: string; via: string }> {
  const { base, model, label } = resolved(st);
  if (!st.apiKey) throw new Error("No AI key yet. Add a free Groq or NVIDIA NIM key in Settings → AI engine.");
  if (!base || !model) throw new Error("AI provider base URL / model not configured");
  const withImage = !!o.imageB64 && VISION.test(model);
  const msgs = messages.map((m, i) =>
    withImage && i === messages.length - 1 && m.role === "user"
      ? { role: "user", content: [{ type: "text", text: m.content }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${o.imageB64}` } }] }
      : m,
  );
  const body: any = { model, messages: msgs, max_tokens: o.maxTokens ?? 4000, temperature: o.temperature ?? 0.7 };
  if (o.json) body.response_format = { type: "json_object" };
  const send = (b: any) => http(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${st.apiKey}` }, body: JSON.stringify(b), timeout: 120000 });
  let r = await send(body);
  if (!r.ok && r.status === 400 && withImage) {
    body.messages = messages;
    r = await send(body);
  }
  if (!r.ok && r.status === 400 && o.json) {
    delete body.response_format;
    r = await send(body);
  }
  if (!r.ok) throw new Error(`${label} ${r.status}: ${r.text.slice(0, 300)}`);
  let j: any = {};
  try {
    j = JSON.parse(r.text);
  } catch {
    throw new Error(`${label} returned a non-JSON response`);
  }
  return { text: String(j.choices?.[0]?.message?.content ?? ""), via: `${label} · ${model}` };
}

export function parseJson<T = any>(text: string): T {
  let t = text.trim().replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("AI returned invalid JSON");
  }
}

export async function chatJson<T = any>(http: HttpFn, st: Settings, system: string, user: string, o: ChatOpts = {}): Promise<{ data: T; via: string }> {
  let lastErr: any;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await chat(http, st, [{ role: "system", content: system + "\nRespond with ONLY one valid JSON object." }, { role: "user", content: user }], { ...o, json: true });
      return { data: parseJson<T>(r.text), via: r.via };
    } catch (e) {
      lastErr = e;
      if (String((e as any)?.message || "").match(/40[13]|not configured|No AI key/)) break;
    }
  }
  throw lastErr;
}

export async function testProvider(http: HttpFn, st: Settings) {
  const t = Date.now();
  const r = await chat(http, st, [{ role: "user", content: "Reply with exactly: ok" }], { maxTokens: 20, temperature: 0 });
  return { ok: true, reply: r.text.slice(0, 40), via: r.via, ms: Date.now() - t };
}

export async function listModels(http: HttpFn, st: Settings) {
  const { base } = resolved(st);
  const r = await http(`${base}/models`, { headers: { Authorization: `Bearer ${st.apiKey}` }, timeout: 20000 });
  if (!r.ok) throw new Error(`${r.status}: ${r.text.slice(0, 200)}`);
  const j: any = JSON.parse(r.text);
  return (j.data || []).map((m: any) => m.id).filter(Boolean).sort();
}
