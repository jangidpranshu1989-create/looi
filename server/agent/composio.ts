/**
 * Composio integration: one-click OAuth "plugins" (Connect Links) + tool execution.
 * REST v3.1 — https://docs.composio.dev/reference
 */
import type { Channel, Settings } from "@shared/schema";
import { chatJson } from "./llm";

const BASE = "https://backend.composio.dev/api/v3.1";

export function composioKey(st: Settings) {
  return (st.composioKey || process.env.COMPOSIO_API_KEY || "").trim();
}
export const composioUser = (ownerId: string) => `looi-${ownerId}`.slice(0, 120);

async function call(key: string, method: string, path: string, body?: any) {
  if (!key) throw new Error("Composio is not set up. Add a Composio API key in Settings → Plugins (or COMPOSIO_API_KEY on the server).");
  const r = await fetch(BASE + path, {
    method,
    headers: { "x-api-key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const t = await r.text();
  let j: any = {};
  try {
    j = t ? JSON.parse(t) : {};
  } catch {}
  if (!r.ok) {
    const e = j?.error;
    throw new Error(`Composio ${r.status}: ${e?.message || t.slice(0, 200)}${e?.suggested_fix ? ` — ${e.suggested_fix}` : ""}`);
  }
  return j;
}

/** Curated marketing plugins. Any other Composio toolkit can also be connected (generic mode). */
export interface PluginDef {
  slug: string;
  name: string;
  category: string;
  blurb: string;
  context?: string[]; // read-only tools run first (e.g. get my profile / pages)
  steps: string[]; // tools that publish (text/link)
  stepsWithImage?: string[]; // preferred when a public poster URL exists
  target?: { label: string; placeholder: string; required?: boolean };
  hint: string;
  needsPublicMedia?: boolean;
}

export const PLUGINS: PluginDef[] = [
  { slug: "twitter", name: "X (Twitter)", category: "Social", blurb: "Post ads as tweets with your tracked link.", steps: ["TWITTER_CREATION_OF_A_POST"], hint: "Use `text` only (max 280 chars, keep the link). X API is pay-per-use: about $0.015 per post, $0.20 if it contains a URL." },
  { slug: "linkedin", name: "LinkedIn", category: "Social", blurb: "Share to your LinkedIn feed.", context: ["LINKEDIN_GET_MY_INFO"], steps: ["LINKEDIN_CREATE_LINKED_IN_POST"], hint: "author must be urn:li:person:<id> from the context result (field like sub/id/author_id). visibility PUBLIC, lifecycleState PUBLISHED. Put the caption in commentary. Set contentLandingPage to the link." },
  { slug: "facebook", name: "Facebook Pages", category: "Social", blurb: "Publish to a Page you manage.", context: ["FACEBOOK_GET_USER_PAGES"], steps: ["FACEBOOK_CREATE_POST"], stepsWithImage: ["FACEBOOK_CREATE_PHOTO_POST"], target: { label: "Page name or ID (optional)", placeholder: "Leave empty for your first Page" }, hint: "page_id comes from the context result; pick the page matching target if given, else the first one. Use message for the caption; for link posts set link. For photo posts set url to the poster URL." },
  { slug: "instagram", name: "Instagram", category: "Social", blurb: "Publish poster posts to a Business account.", context: ["INSTAGRAM_GET_USER_INFO"], steps: [], stepsWithImage: ["INSTAGRAM_CREATE_MEDIA_CONTAINER", "INSTAGRAM_CREATE_POST"], needsPublicMedia: true, hint: "Step 1 creates a media container with image_url = poster URL and caption; step 2 publishes it with creation_id = the id returned by step 1. ig_user_id from the context result." },
  { slug: "reddit", name: "Reddit", category: "Community", blurb: "Submit link posts to a subreddit.", steps: ["REDDIT_CREATE_REDDIT_POST"], target: { label: "Subreddit", placeholder: "SideProject", required: true }, hint: "kind 'link', url = the link, title = a non-salesy honest title (no hashtags), subreddit = target without r/." },
  { slug: "slack", name: "Slack", category: "Community", blurb: "Announce in a Slack channel.", steps: ["SLACK_SEND_MESSAGE"], target: { label: "Channel", placeholder: "#launches or C0123ABC", required: true }, hint: "channel = target. Put the caption as markdown_text or text, include the poster URL on its own line if given." },
  { slug: "discordbot", name: "Discord", category: "Community", blurb: "Post to a Discord channel via bot.", steps: ["DISCORDBOT_CREATE_MESSAGE"], target: { label: "Channel ID", placeholder: "123456789012345678", required: true }, hint: "channel_id = target, content = caption (max 2000), add poster URL on its own line so Discord embeds it." },
  { slug: "telegram", name: "Telegram", category: "Community", blurb: "Send to your channel or group.", steps: ["TELEGRAM_SEND_MESSAGE"], stepsWithImage: ["TELEGRAM_SEND_PHOTO"], target: { label: "Chat / channel", placeholder: "@mychannel or -100123…", required: true }, hint: "chat_id = target. For photo: photo = poster URL, caption max 1024 chars. For message: text = caption." },
  { slug: "gmail", name: "Gmail", category: "Outreach", blurb: "Send launch emails to your list.", steps: ["GMAIL_SEND_EMAIL"], target: { label: "Recipients", placeholder: "a@x.com, b@y.com", required: true }, hint: "recipient_email = first address of target, extra_recipients = the rest. subject = headline, body = caption as friendly plain text with the link. If poster URL is given add it at the end." },
];

export const pluginDef = (slug: string) => PLUGINS.find((p) => p.slug === slug);

// ---------- sessions (cached per user)
const sessions = new Map<string, { id: string; at: number }>();
async function session(key: string, userId: string) {
  const k = key.slice(-8) + userId;
  const c = sessions.get(k);
  if (c && Date.now() - c.at < 30 * 60_000) return c.id;
  const j = await call(key, "POST", "/tool_router/session", { user_id: userId });
  sessions.set(k, { id: j.session_id, at: Date.now() });
  return j.session_id as string;
}

export async function verifyKey(key: string) {
  const j = await call(key, "GET", "/toolkits?limit=1");
  return { ok: true, totalToolkits: j.total_items ?? null };
}

export async function searchToolkits(key: string, q: string) {
  const j = await call(key, "GET", `/toolkits?limit=24&sort_by=usage${q ? `&search=${encodeURIComponent(q)}` : ""}`);
  return (j.items || []).map((t: any) => ({ slug: t.slug, name: t.name, logo: t.meta?.logo || logo(t.slug), description: t.meta?.description || "", noAuth: !!t.no_auth || !!t.is_no_auth }));
}

export const logo = (slug: string) => `https://logos.composio.dev/api/${slug}`;

export async function createConnectLink(key: string, ownerId: string, toolkit: string, callbackUrl?: string) {
  const sid = await session(key, composioUser(ownerId));
  const body: any = { toolkit };
  if (callbackUrl && /^https?:\/\//.test(callbackUrl)) body.callback_url = callbackUrl;
  const j = await call(key, "POST", `/tool_router/session/${sid}/link`, body);
  return { redirectUrl: j.redirect_url as string, connectedAccountId: j.connected_account_id as string };
}

export async function accountStatus(key: string, id: string) {
  const j = await call(key, "GET", `/connected_accounts/${encodeURIComponent(id)}`);
  return { status: String(j.status || "UNKNOWN"), reason: j.status_reason || "", wordId: j.word_id || "", alias: j.alias || "" };
}

export async function deleteAccount(key: string, id: string) {
  try {
    await call(key, "DELETE", `/connected_accounts/${encodeURIComponent(id)}`);
  } catch {}
}

async function execute(key: string, ownerId: string, account: string, tool: string, args: any) {
  // Direct execute pinned to the user's connected account (the tool-router "account" field needs Composio multi-account)
  const body: any = { arguments: args, user_id: composioUser(ownerId) };
  if (account) body.connected_account_id = account;
  const j = await call(key, "POST", `/tools/execute/${encodeURIComponent(tool)}`, body);
  if (j.successful === false || j.error) throw new Error(`${tool}: ${typeof j.error === "string" ? j.error : JSON.stringify(j.error || j.data || "failed").slice(0, 200)}`);
  return j.data ?? j;
}

const schemaCache = new Map<string, any>();
async function toolSchema(key: string, slug: string) {
  if (schemaCache.has(slug)) return schemaCache.get(slug);
  const j = await call(key, "GET", `/tools/${slug}`);
  const s = { slug, description: String(j.description || "").slice(0, 600), input: j.input_parameters || {} };
  schemaCache.set(slug, s);
  return s;
}

/** For non-curated toolkits: let the model pick the publishing tool once at connect time. */
export async function pickPublishTool(st: Settings, key: string, toolkit: string) {
  const j = await call(key, "GET", `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=60`);
  const tools = (j.items || []).map((t: any) => ({ slug: t.slug, d: String(t.description || "").slice(0, 160) }));
  if (!tools.length) throw new Error(`No tools found for ${toolkit}`);
  const { data } = await chatJson<{ tool: string }>(st, "You pick API tools. Reply JSON only.", `Toolkit "${toolkit}". Which ONE tool best publishes a marketing post/message/update with text and a link? If none fits, pick the closest create/send tool.\nTools:\n${tools.map((t: any) => `${t.slug}: ${t.d}`).join("\n")}\nReply {"tool": "<SLUG>"}`, { temperature: 0, maxTokens: 200 });
  const ok = tools.find((t: any) => t.slug === data.tool);
  if (!ok) throw new Error("Could not choose a publishing tool for " + toolkit);
  return ok.slug as string;
}

export interface ComposioPost {
  caption: string;
  title: string;
  link: string;
  posterUrl: string; // public URL or ""
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

export async function publishComposio(st: Settings, ch: Channel, p: ComposioPost) {
  const key = composioKey(st);
  const c = JSON.parse(ch.config || "{}");
  const def = pluginDef(c.toolkit);
  const steps: string[] = p.posterUrl && def?.stepsWithImage?.length ? def.stepsWithImage : def?.steps?.length ? def.steps : c.publishTool ? [c.publishTool] : [];
  if (!steps.length) throw new Error(def?.needsPublicMedia ? `${def.name} needs a public poster URL — set your Looi public URL in Settings.` : "No publishing tool configured for this plugin");
  const context: Record<string, any> = {};
  for (const t of def?.context || []) {
    try {
      context[t] = await execute(key, ch.ownerId, c.connectedAccountId, t, {});
    } catch (e) {
      context[t] = { error: String((e as Error).message).slice(0, 200) };
    }
  }
  const prior: Record<string, any> = {};
  let last: any = null;
  for (const slug of steps) {
    const schema = await toolSchema(key, slug);
    const { data: args } = await chatJson<Record<string, any>>(
      st,
      "You fill API tool arguments for publishing a marketing post. Output ONLY the JSON arguments object that matches the input schema. Never invent IDs — take them from context/previous results. Omit optional fields you don't need.",
      `Tool: ${slug}\nDescription: ${schema.description}\nInput schema: ${JSON.stringify(schema.input).slice(0, 6000)}\n\nPost:\n- caption: ${JSON.stringify(p.caption)}\n- title/headline: ${JSON.stringify(p.title)}\n- link (must be included): ${p.link}\n- poster image URL: ${p.posterUrl || "(none — do not attach media)"}\n- video URL: ${p.videoUrl || "(none)"}\n- user target: ${JSON.stringify(c.target || "")}\n\nPlatform hint: ${def?.hint || "Publish the caption with the link."}\n\nContext results: ${JSON.stringify(context).slice(0, 4000)}\nPrevious step results: ${JSON.stringify(prior).slice(0, 3000)}`,
      { temperature: 0, maxTokens: 1500 },
    );
    last = await execute(key, ch.ownerId, c.connectedAccountId, slug, args);
    prior[slug] = last;
  }
  return { externalId: pickId(last), externalUrl: pickUrl(last) };
}
