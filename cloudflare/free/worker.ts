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
import { ADMIN_HTML } from "./admin-page";

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
  LOOI_UPI_ID?: string;
  LOOI_UPI_NAME?: string;
  LOOI_ADMIN_TOKEN?: string;
  LOOI_PRO_INR?: string;
  LOOI_SCALE_INR?: string;
  LOOI_PROVISIONAL_HOURS?: string;
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-looi-device,x-api-key,x-looi-admin",
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
  const lim = await limitsFor(env, dev);
  if (overLimit("ai:" + dev, lim.ai)) return err(429, lim.key === "free" ? "Daily free Looi AI limit reached on this device. Upgrade to Pro (UPI, 30 days) or add your own free Groq key in Settings. It resets at midnight UTC." : "Daily Looi AI limit for your plan reached. It resets at midnight UTC.");
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
  if (overLimit("m:" + dev, (await limitsFor(env, dev)).media)) return err(429, "Daily public-link limit reached on this device. Upgrade to Pro for more.");
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

// ───────────────────────── Freemium: UPI deep link + UTR (stored in the same free KV) ─────────────────────────
type PlanKey = "free" | "pro" | "scale";
const DAY = 86_400_000;
function plans(env: Env) {
  return {
    free: { key: "free", label: "Free", inr: 0, ai: Number(env.LOOI_DAILY_AI) || 300, media: Number(env.LOOI_DAILY_MEDIA) || 40 },
    pro: { key: "pro", label: "Pro", inr: Number(env.LOOI_PRO_INR) || 999, ai: 3000, media: 300 },
    scale: { key: "scale", label: "Scale", inr: Number(env.LOOI_SCALE_INR) || 2999, ai: 12000, media: 900 },
  } as const;
}
interface DevicePlan { plan: PlanKey; until: number; status: "provisional" | "active"; orderId: string; prev?: DevicePlan | null }
interface Order { orderId: string; device: string; plan: "pro" | "scale"; amount: number; status: "created" | "submitted" | "paid" | "rejected"; utr: string; createdAt: number; utrAt: number; paidAt: number; provisional: boolean; expiresAt: number; note: string }
const planCache = new Map<string, { v: DevicePlan | null; at: number }>();
async function devicePlan(env: Env, dev: string, fresh = false): Promise<DevicePlan | null> {
  if (!dev) return null;
  const c = planCache.get(dev);
  if (!fresh && c && Date.now() - c.at < 5 * 60_000) return c.v;
  let v = (await env.MEDIA.get("p:" + dev, "json")) as DevicePlan | null;
  if (v && v.until < Date.now()) v = null;
  planCache.set(dev, { v, at: Date.now() });
  if (planCache.size > 20000) planCache.clear();
  return v;
}
async function limitsFor(env: Env, dev: string) {
  const P = plans(env);
  const dp = await devicePlan(env, dev);
  return P[dp?.plan || "free"];
}
const upiId = (env: Env) => env.LOOI_UPI_ID || "8529418454@fam";
const upiName = (env: Env) => env.LOOI_UPI_NAME || "Looi";
const inrStr = (paise: number) => (paise / 100).toFixed(2);
const upiUrl = (env: Env, o: Order) =>
  `upi://pay?pa=${upiId(env).replace(/[^a-zA-Z0-9.@_-]/g, "")}&pn=${encodeURIComponent(upiName(env))}&am=${inrStr(o.amount)}&cu=INR&tn=${encodeURIComponent("Looi " + o.plan + " " + o.orderId)}`;
const pub = (env: Env, o: Order) => ({ ...o, amountInr: inrStr(o.amount), upiUrl: upiUrl(env, o), vpa: upiId(env), payee: upiName(env) });
const rid = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

async function billing(req: Request, env: Env, sub: string) {
  const dev = deviceOf(req);
  const P = plans(env);
  if (sub === "/plans" || sub === "/me") {
    const dp = dev ? await devicePlan(env, dev, true) : null;
    const last = dev ? ((await env.MEDIA.get("last:" + dev, "json")) as Order | null) : null;
    return json({ vpa: upiId(env), payee: upiName(env), plans: Object.values(P), current: dp ? { ...dp, ...P[dp.plan] } : { plan: "free", ...P.free }, last: last ? pub(env, last) : null, provisionalHours: Number(env.LOOI_PROVISIONAL_HOURS) || 48 });
  }
  if (!dev) return err(400, "Missing device id. Update the app and try again.");
  if (sub === "/order" && req.method === "POST") {
    const b = (await req.json().catch(() => ({}))) as { plan?: string };
    const plan = b.plan === "scale" ? "scale" : "pro";
    if (overLimit("ord:" + dev, 20)) return err(429, "Too many payment attempts today. Please WhatsApp +91 85294 18454.");
    let amount = 0;
    for (let i = 0; i < 6; i++) {
      const a = P[plan].inr * 100 + 1 + Math.floor(Math.random() * 98);
      if (!(await env.MEDIA.get("a:" + a))) { amount = a; break; }
    }
    if (!amount) amount = P[plan].inr * 100 + 1 + Math.floor(Math.random() * 98);
    const o: Order = { orderId: "LOOI" + rid(6), device: dev, plan, amount, status: "created", utr: "", createdAt: Date.now(), utrAt: 0, paidAt: 0, provisional: false, expiresAt: 0, note: "" };
    await env.MEDIA.put("o:" + o.orderId, JSON.stringify(o), { expirationTtl: 90 * 86400 });
    await env.MEDIA.put("a:" + amount, o.orderId, { expirationTtl: 2 * 86400 });
    await env.MEDIA.put("last:" + dev, JSON.stringify(o), { expirationTtl: 90 * 86400 });
    return json(pub(env, o));
  }
  if (sub === "/utr" && req.method === "POST") {
    const b = (await req.json().catch(() => ({}))) as { orderId?: string; utr?: string };
    const utr = String(b.utr || "").replace(/\D/g, "");
    if (!/^\d{12}$/.test(utr)) return err(400, "UTR must be the 12-digit UPI reference number.");
    const o = (await env.MEDIA.get("o:" + String(b.orderId || "").replace(/[^A-Z0-9]/g, ""), "json")) as Order | null;
    if (!o || o.device !== dev) return err(404, "Order not found on this device.");
    if (o.status === "paid") return json({ provisional: false, payment: pub(env, o) });
    const dupe = await env.MEDIA.get("u:" + utr);
    if (dupe && dupe !== o.orderId) return err(409, "This UTR was already used for another payment.");
    const flagged = await env.MEDIA.get("r:" + dev);
    const hours = Number(env.LOOI_PROVISIONAL_HOURS) || 48;
    o.utr = utr; o.utrAt = Date.now(); o.status = "submitted"; o.provisional = !flagged; o.expiresAt = o.provisional ? Date.now() + hours * 3600_000 : 0;
    await env.MEDIA.put("u:" + utr, o.orderId);
    await env.MEDIA.put("o:" + o.orderId, JSON.stringify(o), { expirationTtl: 90 * 86400 });
    await env.MEDIA.put("last:" + dev, JSON.stringify(o), { expirationTtl: 90 * 86400 });
    if (o.provisional) {
      const cur = await devicePlan(env, dev, true);
      const prev = cur?.status === "active" ? { ...cur, prev: null } : cur?.prev || null;
      await env.MEDIA.put("p:" + dev, JSON.stringify({ plan: o.plan, until: Math.max(o.expiresAt, prev?.until || 0), status: "provisional", orderId: o.orderId, prev } satisfies DevicePlan));
      planCache.delete(dev);
    }
    return json({ provisional: o.provisional, payment: pub(env, o) });
  }
  return err(404, "Unknown billing route");
}

async function admin(req: Request, env: Env, sub: string) {
  const tok = req.headers.get("x-looi-admin") || "";
  if (!env.LOOI_ADMIN_TOKEN || tok.length < 16 || tok !== env.LOOI_ADMIN_TOKEN) return err(401, "Wrong admin key.");
  if (sub === "/orders" && req.method === "GET") {
    const out: any[] = [];
    let cursor: string | undefined;
    do {
      const l = await env.MEDIA.list({ prefix: "o:", cursor, limit: 1000 });
      const vals = await Promise.all(l.keys.map((k) => env.MEDIA.get(k.name, "json")));
      for (const v of vals) if (v) out.push(pub(env, v as Order));
      cursor = l.list_complete ? undefined : l.cursor;
    } while (cursor && out.length < 3000);
    out.sort((a, b) => (b.utrAt || b.createdAt) - (a.utrAt || a.createdAt));
    const paid = out.filter((o) => o.status === "paid");
    return json({ orders: out.filter((o) => o.status !== "created" || Date.now() - o.createdAt < 3 * DAY), stats: { paying: paid.length, revenueInr: paid.reduce((s, o) => s + o.amount, 0) / 100, pending: out.filter((o) => o.status === "submitted").length } });
  }
  const m = sub.match(/^\/orders\/([A-Z0-9]+)\/(approve|reject)$/);
  if (m && req.method === "POST") {
    const o = (await env.MEDIA.get("o:" + m[1], "json")) as Order | null;
    if (!o) return err(404, "Order not found");
    const cur = await devicePlan(env, o.device, true);
    if (m[2] === "approve") {
      const act = cur?.status === "active" ? cur : cur?.prev;
      const base = act && act.until > Date.now() ? act.until : Date.now();
      o.status = "paid"; o.paidAt = Date.now(); o.provisional = false;
      await env.MEDIA.put("p:" + o.device, JSON.stringify({ plan: o.plan, until: base + 30 * DAY, status: "active", orderId: o.orderId } satisfies DevicePlan));
    } else {
      o.status = "rejected"; o.provisional = false; o.note = "Payment not found";
      await env.MEDIA.put("r:" + o.device, "1", { expirationTtl: 180 * 86400 });
      if (cur && cur.orderId === o.orderId && cur.status === "provisional") {
        if (cur.prev && cur.prev.until > Date.now()) await env.MEDIA.put("p:" + o.device, JSON.stringify(cur.prev));
        else await env.MEDIA.delete("p:" + o.device);
      }
      if (o.utr) await env.MEDIA.delete("u:" + o.utr);
    }
    await env.MEDIA.put("o:" + o.orderId, JSON.stringify(o), { expirationTtl: 90 * 86400 });
    await env.MEDIA.put("last:" + o.device, JSON.stringify(o), { expirationTtl: 90 * 86400 });
    planCache.delete(o.device);
    return json(pub(env, o));
  }
  return err(404, "Unknown admin route");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === "OPTIONS" && (p.startsWith("/relay/") || p.startsWith("/m/"))) return new Response(null, { status: 204, headers: CORS });
    try {
      if (p === "/relay/status") return json({ ok: true, free: true, ai: hops(env).length > 0, composio: !!env.COMPOSIO_API_KEY, media: true, fetch: true, payments: true, upi: upiId(env) });
      if (p === "/relay/ai/chat/completions" && req.method === "POST") return aiChat(req, env);
      if (p === "/relay/ai/models") return json({ data: [{ id: "looi", object: "model" }] });
      if (p.startsWith("/relay/composio/")) return composio(req, env, p.slice("/relay/composio".length));
      if (p === "/relay/media" && req.method === "POST") return putMedia(req, env);
      if (p.startsWith("/m/") && req.method === "GET") return getMedia(req, env, p.slice(3).replace(/[^a-zA-Z0-9.]/g, ""));
      if (p === "/relay/fetch") return proxyFetch(req);
      if (p.startsWith("/relay/pay/")) return billing(req, env, p.slice("/relay/pay".length));
      if (p.startsWith("/relay/admin/")) return admin(req, env, p.slice("/relay/admin".length));
      if (p === "/admin" || p === "/admin/") return new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" } });
      if (p === "/api/health") return json({ ok: true, free: true, ts: Date.now() });
    } catch (e: any) {
      return err(500, String(e?.message || e));
    }
    return env.ASSETS.fetch(req);
  },
};
