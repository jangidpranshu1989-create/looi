/** Composio REST v3.1 client for the on-device engine — https://docs.composio.dev/reference */
import type { HttpFn } from "./http";
import type { Settings } from "./types";
import { chatJson } from "./llm";
import { pluginDef, logo } from "./plugins";
export { PLUGINS, pluginDef, logo } from "./plugins";

const BASE = "https://backend.composio.dev/api/v3.1";

export const composioUser = (userId: string) => `looi-${userId}`.slice(0, 120);

/** The user's own Composio key, or "relay:<url>|<device>" for the free shared plugins on the Looi relay. */
export function cxKey(st: Settings) {
  const own = (st.composioKey || "").trim();
  if (own) return own;
  return st.relayUrl && st.relayComposio ? `relay:${st.relayUrl.replace(/\/$/, "")}|${st.deviceId || st.userId || ""}` : "";
}

async function call(http: HttpFn, key: string, method: string, path: string, body?: any) {
  if (!key) throw new Error("Composio is not set up. Add your Composio API key in Plugins.");
  let url = BASE + path;
  let headers: Record<string, string> = { "x-api-key": key };
  if (key.startsWith("relay:")) {
    const [base, dev] = key.slice(6).split("|");
    url = `${base}/relay/composio${path}`;
    headers = { "X-Looi-Device": dev };
  }
  const r = await http(url, { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, timeout: 60000 });
  let j: any = {};
  try {
    j = r.text ? JSON.parse(r.text) : {};
  } catch {}
  if (!r.ok) {
    const e = j?.error;
    throw new Error(`Composio ${r.status}: ${e?.message || r.text.slice(0, 200)}${e?.suggested_fix ? ` — ${e.suggested_fix}` : ""}`);
  }
  return j;
}

const sessions = new Map<string, { id: string; at: number }>();
async function session(http: HttpFn, key: string, userId: string) {
  const k = key.slice(-8) + userId;
  const c = sessions.get(k);
  if (c && Date.now() - c.at < 30 * 60_000) return c.id;
  const j = await call(http, key, "POST", "/tool_router/session", { user_id: userId });
  sessions.set(k, { id: j.session_id, at: Date.now() });
  return j.session_id as string;
}

export async function verifyKey(http: HttpFn, key: string) {
  const j = await call(http, key, "GET", "/toolkits?limit=1");
  return { ok: true, totalToolkits: j.total_items ?? null };
}

export async function searchToolkits(http: HttpFn, key: string, q: string) {
  const j = await call(http, key, "GET", `/toolkits?limit=24&sort_by=usage${q ? `&search=${encodeURIComponent(q)}` : ""}`);
  return (j.items || []).map((t: any) => ({ slug: t.slug, name: t.name, logo: t.meta?.logo || logo(t.slug), description: t.meta?.description || "", noAuth: !!t.no_auth || !!t.is_no_auth }));
}

export async function createConnectLink(http: HttpFn, key: string, userId: string, toolkit: string, callbackUrl?: string) {
  const sid = await session(http, key, composioUser(userId));
  const body: any = { toolkit };
  if (callbackUrl && /^https:\/\//.test(callbackUrl) && !/localhost/.test(callbackUrl)) body.callback_url = callbackUrl;
  const j = await call(http, key, "POST", `/tool_router/session/${sid}/link`, body);
  return { redirectUrl: j.redirect_url as string, connectedAccountId: j.connected_account_id as string };
}

export async function accountStatus(http: HttpFn, key: string, id: string) {
  const j = await call(http, key, "GET", `/connected_accounts/${encodeURIComponent(id)}`);
  return { status: String(j.status || "UNKNOWN"), reason: j.status_reason || "" };
}

export async function deleteAccount(http: HttpFn, key: string, id: string) {
  try {
    await call(http, key, "DELETE", `/connected_accounts/${encodeURIComponent(id)}`);
  } catch {}
}

async function execute(http: HttpFn, key: string, userId: string, account: string, tool: string, args: any) {
  // Direct execute pinned to the user's connected account (the tool-router "account" field needs Composio multi-account)
  const body: any = { arguments: args, user_id: composioUser(userId) };
  if (account) body.connected_account_id = account;
  const j = await call(http, key, "POST", `/tools/execute/${encodeURIComponent(tool)}`, body);
  if (j.successful === false || j.error) throw new Error(`${tool}: ${typeof j.error === "string" ? j.error : JSON.stringify(j.error || j.data || "failed").slice(0, 200)}`);
  return j.data ?? j;
}

const schemaCache = new Map<string, any>();
async function toolSchema(http: HttpFn, key: string, slug: string) {
  if (schemaCache.has(slug)) return schemaCache.get(slug);
  const j = await call(http, key, "GET", `/tools/${slug}`);
  const s = { slug, description: String(j.description || "").slice(0, 600), input: j.input_parameters || {} };
  schemaCache.set(slug, s);
  return s;
}

export async function pickPublishTool(http: HttpFn, st: Settings, key: string, toolkit: string) {
  const j = await call(http, key, "GET", `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=60`);
  const tools = (j.items || []).map((t: any) => ({ slug: t.slug, d: String(t.description || "").slice(0, 160) }));
  if (!tools.length) throw new Error(`No tools found for ${toolkit}`);
  const { data } = await chatJson<{ tool: string }>(http, st, "You pick API tools. Reply JSON only.", `Toolkit "${toolkit}". Which ONE tool best publishes a marketing post/message/update with text and a link? If none fits, pick the closest create/send tool.\nTools:\n${tools.map((t: any) => `${t.slug}: ${t.d}`).join("\n")}\nReply {"tool": "<SLUG>"}`, { temperature: 0, maxTokens: 200 });
  const ok = tools.find((t: any) => t.slug === data.tool);
  if (!ok) throw new Error("Could not choose a publishing tool for " + toolkit);
  return ok.slug as string;
}

export interface ComposioPost {
  caption: string;
  title: string;
  link: string;
  posterUrl: string;
  videoUrl: string;
}

const pickUrl = (d: any): string => {
  const s = JSON.stringify(d || {});
  const m = s.match(/https?:\/\/(?:www\.)?(?:x|twitter|linkedin|facebook|instagram|reddit|t\.me|discord|slack)[^"\\\s]*/i);
  return m ? m[0] : "";
};
const pickId = (d: any): string => {
  const x = d?.data ?? d;
  return String(x?.id || x?.data?.id || x?.post_id || x?.message_id || x?.result?.message_id || x?.name || x?.ts || "").slice(0, 120);
};

export async function publishComposio(http: HttpFn, st: Settings, userId: string, cfg: any, p: ComposioPost) {
  const key = cxKey(st);
  const def = pluginDef(cfg.toolkit);
  const steps: string[] = p.posterUrl && def?.stepsWithImage?.length ? def.stepsWithImage : def?.steps?.length ? def.steps : cfg.publishTool ? [cfg.publishTool] : [];
  if (!steps.length) throw new Error(def?.needsPublicMedia ? `${def.name} needs a public image link for the ad. Turn on Looi Free (Settings → Where Looi runs) or set a public media URL, then publish again.` : "No publishing tool configured for this plugin");
  const context: Record<string, any> = {};
  for (const t of def?.context || []) {
    try {
      context[t] = await execute(http, key, userId, cfg.connectedAccountId, t, {});
    } catch (e) {
      context[t] = { error: String((e as Error).message).slice(0, 200) };
    }
  }
  const prior: Record<string, any> = {};
  let last: any = null;
  for (const slug of steps) {
    const schema = await toolSchema(http, key, slug);
    const { data: args } = await chatJson<Record<string, any>>(
      http,
      st,
      "You fill API tool arguments for publishing a marketing post. Output ONLY the JSON arguments object that matches the input schema. Never invent IDs — take them from context/previous results. Omit optional fields you don't need.",
      `Tool: ${slug}\nDescription: ${schema.description}\nInput schema: ${JSON.stringify(schema.input).slice(0, 6000)}\n\nPost:\n- caption: ${JSON.stringify(p.caption)}\n- title/headline: ${JSON.stringify(p.title)}\n- link (must be included): ${p.link}\n- poster image URL: ${p.posterUrl || "(none — do not attach media)"}\n- video URL: ${p.videoUrl || "(none)"}\n- user target: ${JSON.stringify(cfg.target || "")}\n\nPlatform hint: ${def?.hint || "Publish the caption with the link."}\n\nContext results: ${JSON.stringify(context).slice(0, 4000)}\nPrevious step results: ${JSON.stringify(prior).slice(0, 3000)}`,
      { temperature: 0, maxTokens: 1500 },
    );
    last = await execute(http, key, userId, cfg.connectedAccountId, slug, args);
    prior[slug] = last;
  }
  return { externalId: pickId(last), externalUrl: pickUrl(last) };
}
