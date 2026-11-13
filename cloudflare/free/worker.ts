/**
 * Looi Free — runs on the Cloudflare Workers FREE plan (no card, $0).
 *
 * The agent itself runs on the user's phone (Android app, 24/7 background checks) or in the browser tab.
 * This Worker gives every device what it can't do alone:
 *   /                     the web app (static assets, unlimited + free)
 *   /relay/ai/*           Looi AI with the owner's keys — NVIDIA NIM first, instant switch to Groq on any failure
 *   /relay/composio/*     one-click publishing plugins with the owner's Composio key (scoped per device)
 *   /relay/media          public links for rendered ads (Instagram & co. need a public image URL), kept 7 days
 *   /m/<id>               serves those links
 *   /relay/fetch          CORS-free fetch so the browser version can audit any site
 *   /relay/status         which shared services are switched on
 */
export interface Env {
  ASSETS: Fetcher;
  MEDIA: KVNamespace;
  NVIDIA_API_KEY?: string;
  NVIDIA_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  LOOI_AI_BASE_URL?: string;
  LOOI_AI_KEY?: string;
  LOOI_AI_MODEL?: string;
  COMPOSIO_API_KEY?: string;
  LOOI_NIM_TIMEOUT_MS?: string;
  LOOI_DAILY_AI?: string;
  LOOI_DAILY_MEDIA?: string;
  NVIDIA_BASE_URL?: string;
  GROQ_BASE_URL?: string;
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-looi-device,x-api-key",
  "access-control-max-age": "86400",
};
const json = (d: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });
const err = (status: number, message: string) => json({ error: { message }, message }, status);

/** Device id from the app (random, generated on first launch). */
function deviceOf(req: Request) {
  const d = (req.headers.get("x-looi-device") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return d.length >= 8 ? d : "";
}

// Best-effort per-isolate fair use (free plan: no paid rate-limit storage). Keeps one device from draining shared keys.
const buckets = new Map<string, { n: number; day: string }>();
function overLimit(key: string, max: number) {
  const day = new Date().toISOString().slice(0, 10);
  const b = buckets.get(key);
  if (!b || b.day !== day) {
    buckets.set(key, { n: 1, day });
    if (buckets.size > 20000) buckets.clear();
    return false;
  }
  b.n++;
  return b.n > max;
}
const ipOf = (req: Request) => req.headers.get("cf-connecting-ip") || "0";

// ---------------- Looi AI: NIM → Groq → others, with a circuit breaker ----------------
type Hop = { key: string; base: string; apiKey: string; model: string; timeout: number };
const tripped = new Map<string, number>();
function hops(env: Env): Hop[] {
  const nimT = Number(env.LOOI_NIM_TIMEOUT_MS) || 45000;
  const all: (Hop | null)[] = [
    env.LOOI_AI_BASE_URL && env.LOOI_AI_KEY ? { key: "custom", base: env.LOOI_AI_BASE_URL.replace(/\/$/, ""), apiKey: env.LOOI_AI_KEY, model: env.LOOI_AI_MODEL || "", timeout: 90000 } : null,
    env.NVIDIA_API_KEY ? { key: "nvidia", base: (env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""), apiKey: env.NVIDIA_API_KEY, model: env.NVIDIA_MODEL || "openai/gpt-oss-120b", timeout: nimT } : null,
    env.GROQ_API_KEY ? { key: "groq", base: (env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""), apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL || "openai/gpt-oss-120b", timeout: 90000 } : null,
  ];
  const list = all.filter(Boolean) as Hop[];
  const now = Date.now();
  const healthy = list.filter((h) => (tripped.get(h.key) || 0) < now);
  return healthy.length ? healthy : list; // everything tripped → try all anyway
}

async function aiChat(req: Request, env: Env) {
  const list = hops(env);
  if (!list.length) return err(503, "Looi AI is not switched on for this deployment. Add your own free Groq key in Settings → AI engine.");
  const dev = deviceOf(req) || ipOf(req);
  if (overLimit("ai:" + dev, Number(env.LOOI_DAILY_AI) || 300)) return err(429, "Daily free Looi AI limit reached on this device. It resets at midnight UTC, or add your own free Groq key in Settings.");
  let body: any;
  try {
    body = await req.json();
  } catch {
    return err(400, "Bad JSON");
  }
  if (!Array.isArray(body?.messages)) return err(400, "messages required");
  body.max_tokens = Math.min(Number(body.max_tokens) || 4000, 8000);
  delete body.stream;
  const errors: string[] = [];
  for (const h of list) {
    try {
      const r = await fetch(`${h.base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${h.apiKey}` },
        body: JSON.stringify({ ...body, model: h.model || body.model }),
        signal: AbortSignal.timeout(h.timeout),
      });
      const text = await r.text();
      if (!r.ok) {
        // retry once without response_format on providers that reject it
        if (r.status === 400 && body.response_format) {
          const r2 = await fetch(`${h.base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${h.apiKey}` }, body: JSON.stringify({ ...body, response_format: undefined, model: h.model || body.model }), signal: AbortSignal.timeout(h.timeout) });
          const t2 = await r2.text();
          if (r2.ok && JSON.parse(t2)?.choices?.[0]?.message?.content) return json({ ...JSON.parse(t2), looi_via: h.key });
        }
        throw new Error(`${h.key} ${r.status}: ${text.slice(0, 160)}`);
      }
      const j = JSON.parse(text);
      if (!String(j?.choices?.[0]?.message?.content || "").trim()) throw new Error(`${h.key}: empty reply`);
      return json({ ...j, looi_via: h.key });
    } catch (e: any) {
      tripped.set(h.key, Date.now() + 3 * 60_000);
      errors.push(String(e?.message || e).slice(0, 200));
      console.log("[looi-ai] switching:", errors[errors.length - 1]);
    }
  }
  return err(502, "Looi AI is busy right now: " + errors.join(" | "));
}

// ---------------- Composio proxy (owner's key, each device is its own Composio user) ----------------
const COMPOSIO = "https://backend.composio.dev/api/v3.1";
function scopeUser(v: any, user: string): any {
  if (Array.isArray(v)) return v.map((x) => scopeUser(x, user));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = k === "user_id" || k === "entity_id" ? user : scopeUser(x, user);
    return o;
  }
  return v;
}
async function composio(req: Request, env: Env, path: string) {
  if (!env.COMPOSIO_API_KEY) return err(503, "Shared publishing plugins are not switched on here. Add your own Composio key in Plugins.");
  const dev = deviceOf(req);
  if (!dev) return err(400, "Missing device id");
  if (overLimit("cx:" + dev, 600)) return err(429, "Too many plugin calls from this device today.");
  if (!/^\/(tool_router\/session(\/[^/]+\/(link))?|tools\/execute\/[A-Z0-9_]+|tools(\/[A-Z0-9_]+)?|toolkits|connected_accounts\/[a-zA-Z0-9_-]+)$/.test(path)) return err(403, "Not allowed");
  const user = `looi-free-${dev}`;
  const url = new URL(req.url);
  const target = new URL(COMPOSIO + path + url.search);
  if (target.searchParams.has("user_id")) target.searchParams.set("user_id", user);
  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "DELETE") {
    const j = await req.json().catch(() => ({}));
    body = JSON.stringify(scopeUser(j, user));
  }
  const r = await fetch(target, { method: req.method, headers: { "x-api-key": env.COMPOSIO_API_KEY, ...(body ? { "content-type": "application/json" } : {}) }, body });
  return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", ...CORS } });
}

// ---------------- Public media for ads ----------------
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "image/gif": "gif" };
async function putMedia(req: Request, env: Env) {
  const dev = deviceOf(req) || ipOf(req);
  if (overLimit("m:" + dev, Number(env.LOOI_DAILY_MEDIA) || 40)) return err(429, "Daily public-link limit reached on this device.");
  const type = (req.headers.get("content-type") || "").split(";")[0].trim();
  const ext = EXT[type];
  if (!ext) return err(415, "Only JPG, PNG, WebP, GIF, MP4 or WebM");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 24 * 1024 * 1024) return err(413, "Max 24 MB per file");
  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 24 * 1024 * 1024) return err(413, "Max 24 MB per file");
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20) + "." + ext;
  await env.MEDIA.put("m/" + id, buf, { expirationTtl: 7 * 86400, metadata: { type } });
  return json({ url: `${new URL(req.url).origin}/m/${id}`, expiresInDays: 7 });
}
async function getMedia(req: Request, env: Env, id: string) {
  const { value, metadata } = await env.MEDIA.getWithMetadata<{ type: string }>("m/" + id, "stream");
  if (!value) return new Response("Not found", { status: 404, headers: CORS });
  return new Response(value, { headers: { "content-type": metadata?.type || "application/octet-stream", "cache-control": "public, max-age=86400", ...CORS } });
}

// ---------------- CORS-free fetch for the browser version ----------------
function blockedHost(h: string) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|metadata)/i.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith(".internal") || h.endsWith(".local");
}
async function proxyFetch(req: Request) {
  const dev = deviceOf(req) || ipOf(req);
  if (overLimit("f:" + dev, 3000)) return err(429, "Too many requests today");
  if (req.method === "GET") {
    // raw binary passthrough (images for audits / ads)
    const u = new URL(req.url).searchParams.get("url") || "";
    let t: URL;
    try {
      t = new URL(u);
    } catch {
      return err(400, "bad url");
    }
    if (!/^https?:$/.test(t.protocol) || blockedHost(t.hostname)) return err(400, "blocked url");
    const r = await fetch(t, { headers: { "user-agent": "Mozilla/5.0 (compatible; LooiBot/1.0; +https://github.com/jangidpranshu1989-create/looi)" }, redirect: "follow" });
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/octet-stream", ...CORS } });
  }
  const o = (await req.json().catch(() => null)) as { url?: string; method?: string; headers?: Record<string, string>; body?: string; timeout?: number } | null;
  if (!o?.url) return err(400, "url required");
  let t: URL;
  try {
    t = new URL(o.url);
  } catch {
    return err(400, "bad url");
  }
  if (!/^https?:$/.test(t.protocol) || blockedHost(t.hostname)) return err(400, "blocked url");
  const t0 = Date.now();
  try {
    const r = await fetch(t, { method: o.method || "GET", headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36 LooiBot/1.0", ...(o.headers || {}) }, body: o.body, redirect: "follow", signal: AbortSignal.timeout(Math.min(o.timeout || 30000, 90000)) });
    const ct = r.headers.get("content-type") || "";
    const text = /text|json|xml|javascript|css|svg/i.test(ct) || !ct ? (await r.text()).slice(0, 4_000_000) : "";
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => (headers[k] = v));
    return json({ status: r.status, ok: r.ok, url: r.url, headers, text, ms: Date.now() - t0 });
  } catch (e: any) {
    return json({ status: 0, ok: false, url: o.url, headers: {}, text: String(e?.message || e), ms: Date.now() - t0 });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === "OPTIONS" && (p.startsWith("/relay/") || p.startsWith("/m/"))) return new Response(null, { status: 204, headers: CORS });
    try {
      if (p === "/relay/status") return json({ ok: true, free: true, ai: hops(env).length > 0, composio: !!env.COMPOSIO_API_KEY, media: true, fetch: true });
      if (p === "/relay/ai/chat/completions" && req.method === "POST") return aiChat(req, env);
      if (p === "/relay/ai/models") return json({ data: [{ id: "looi", object: "model" }] });
      if (p.startsWith("/relay/composio/")) return composio(req, env, p.slice("/relay/composio".length));
      if (p === "/relay/media" && req.method === "POST") return putMedia(req, env);
      if (p.startsWith("/m/") && req.method === "GET") return getMedia(req, env, p.slice(3).replace(/[^a-zA-Z0-9.]/g, ""));
      if (p === "/relay/fetch") return proxyFetch(req);
      if (p === "/api/health") return json({ ok: true, free: true, ts: Date.now() });
    } catch (e: any) {
      return err(500, String(e?.message || e));
    }
    return env.ASSETS.fetch(req);
  },
};
