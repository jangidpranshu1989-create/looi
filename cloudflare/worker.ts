/**
 * Looi on Cloudflare
 *  - Static web app served from the edge (Workers Static Assets)
 *  - API, 24/7 agent, Chromium + FFmpeg ad renderer run in one always-on Cloudflare Container
 *  - Database snapshots + media live in R2 (container disks are ephemeral); media is served straight from R2
 *  - A cron trigger pings the container every 2 minutes so the agent never sleeps
 */
import { Container, getContainer } from "@cloudflare/containers";
export { ContainerProxy } from "@cloudflare/containers";

export interface Env {
  LOOI: DurableObjectNamespace<LooiServer>;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  [key: string]: any;
}

/** Worker vars / secrets forwarded into the container. */
const PASS = [
  "GROQ_API_KEY", "GROQ_MODEL", "NVIDIA_API_KEY", "NVIDIA_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL",
  "LOOI_AI_BASE_URL", "LOOI_AI_KEY", "LOOI_AI_MODEL", "LOOI_AI_ORDER", "LOOI_NIM_TIMEOUT_MS", "LOOI_AI_COOLDOWN_MS",
  "COMPOSIO_API_KEY", "PSI_API_KEY", "ADMIN_EMAILS", "LOOI_PUBLIC_URL",
  "LOOI_TRIAL_DAYS", "LOOI_PRICE_PRO_INR", "LOOI_PRICE_SCALE_INR", "LOOI_WORKERS",
  "LOOI_UPI_ID", "LOOI_UPI_NAME", "LOOI_SUPPORT_EMAIL", "LOOI_SUPPORT_WHATSAPP", "LOOI_PROVISIONAL_HOURS",
];

/** The container reaches R2 through this virtual host (never leaves Cloudflare, no S3 keys needed). */
async function r2(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const key = decodeURIComponent(url.pathname.slice(1));
  if (key === "_list") {
    const prefix = url.searchParams.get("prefix") || "";
    const out: { key: string; size: number; uploaded: number }[] = [];
    let cursor: string | undefined;
    do {
      const l = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
      for (const o of l.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded.getTime() });
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
    return Response.json(out);
  }
  if (!key || key.includes("..")) return new Response("bad key", { status: 400 });
  if (req.method === "PUT") {
    await env.BUCKET.put(key, req.body, { httpMetadata: { contentType: mime(key) } });
    return new Response("ok");
  }
  if (req.method === "DELETE") {
    await env.BUCKET.delete(key);
    return new Response("ok");
  }
  const o = await env.BUCKET.get(key);
  if (!o) return new Response("not found", { status: 404 });
  return new Response(o.body, { headers: { "content-length": String(o.size) } });
}

export class LooiServer extends Container<Env> {
  defaultPort = 5000;
  sleepAfter = "30m";
  enableInternet = true;
  static outboundByHost = { "r2.looi": (req: Request, env: Env) => r2(req, env) };

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    const vars: Record<string, string> = { LOOI_SAAS: "1", LOOI_R2_URL: "http://r2.looi", LOOI_TRUST_CF: "1", PORT: "5000" };
    for (const k of PASS) if (env[k] != null && env[k] !== "") vars[k] = String(env[k]);
    this.envVars = vars;
  }
  override onStop({ exitCode, reason }: { exitCode: number; reason: string }) {
    console.log("looi container stopped", { exitCode, reason });
  }
}

const MIME: Record<string, string> = { mp4: "video/mp4", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", json: "application/json", db: "application/octet-stream" };
const mime = (k: string) => MIME[k.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";

/** Serve rendered ads / screenshots straight from R2 at the edge (with Range support for video seeking). */
async function media(req: Request, env: Env, file: string): Promise<Response | null> {
  const key = `media/${file}`;
  const range = req.headers.get("range");
  const o = await env.BUCKET.get(key, range ? { range: req.headers } : {});
  if (!o) return null;
  const h = new Headers({ "content-type": mime(file), "cache-control": "public, max-age=31536000, immutable", "accept-ranges": "bytes", etag: o.httpEtag, "access-control-allow-origin": "*" });
  if (new URL(req.url).searchParams.get("download")) h.set("content-disposition", `attachment; filename="looi-${file}"`);
  const r = (o as any).range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && r && "body" in o) {
    const offset = r.suffix != null ? o.size - r.suffix : r.offset ?? 0;
    const length = r.suffix != null ? r.suffix : r.length ?? o.size - offset;
    h.set("content-range", `bytes ${offset}-${offset + length - 1}/${o.size}`);
    h.set("content-length", String(length));
    return new Response((o as R2ObjectBody).body, { status: 206, headers: h });
  }
  h.set("content-length", String(o.size));
  return new Response((o as R2ObjectBody).body, { headers: h });
}

const looi = (env: Env) => getContainer(env.LOOI, "main");

async function toContainer(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const fwd = new Request(req);
  fwd.headers.set("x-looi-origin", url.origin);
  const stub = looi(env);
  try {
    return await stub.fetch(fwd);
  } catch (e) {
    // container was asleep / restarting: boot it (restore from R2 can take a little while) and retry once
    try {
      await stub.startAndWaitForPorts({ ports: [5000], cancellationOptions: { portReadyTimeoutMS: 180_000 } });
      return await stub.fetch(new Request(fwd));
    } catch {
      return Response.json({ message: "Looi is waking up. Try again in a few seconds." }, { status: 503, headers: { "retry-after": "10" } });
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/(?:public\/)?media\/([^/]+)$/);
    if (m && req.method === "GET") {
      const hit = await media(req, env, decodeURIComponent(m[1]).replace(/[\\/]/g, ""));
      if (hit) return hit;
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/r/")) return toContainer(req, env);
    return env.ASSETS.fetch(req);
  },
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    // keeps the always-on agent awake (and wakes it after host restarts)
    ctx.waitUntil(toContainer(new Request("https://looi.internal/api/health"), env).then((r) => r.body?.cancel()));
  },
};
