/** In-app API router for on-device mode. Implements the same endpoints/shapes as server/routes.ts. */
import { db, type Row } from "./db";
import { http } from "./net";
import { PROVIDERS, testProvider, listModels, hasAi } from "./core/llm";
import * as cx from "./core/composio";
import { FORMATS, TEMPLATES } from "./core/marketing";
import { normalizeUrl } from "./analyze";
import { deleteMedia } from "./media";
import * as A from "./agent";

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}
const json = (data: any, status = 200) => new Response(JSON.stringify(data ?? null), { status, headers: { "Content-Type": "application/json" } });

const CHANNEL_TYPES = {
  webhook: { label: "Webhook (Zapier / Make / n8n)", fields: [{ key: "url", label: "Webhook URL", placeholder: "https://hooks.zapier.com/..." }], media: "any", docs: "https://zapier.com/apps/webhook/integrations", note: "Sends JSON with caption, link and a base64 poster. Route to any app." },
};

function maskSettings(s: any) {
  const { apiKey, psiKey, composioKey, ...rest } = s;
  return { ...rest, hasComposioKey: !!composioKey, composioKeyHint: composioKey ? "••••" + composioKey.slice(-4) : "", hasApiKey: !!apiKey, apiKeyHint: apiKey ? "••••" + apiKey.slice(-4) : "", hasPsiKey: !!psiKey, builtinAvailable: !!(s.relayUrl && s.relayAi), relayUrl: s.relayUrl || "", relayAi: !!s.relayAi, relayComposio: !!s.relayComposio, composioServer: !!s.relayComposio && !composioKey, device: true };
}
function maskChannel(c: Row) {
  const cfg = c.config || {};
  if (c.type === "composio") {
    const def = cx.pluginDef(cfg.toolkit);
    return { ...c, config: { toolkit: cfg.toolkit, target: cfg.target || "", logo: cfg.logo || cx.logo(cfg.toolkit), tool: def ? (def.stepsWithImage?.length && !def.steps.length ? def.stepsWithImage : def.steps).join(" → ") : cfg.publishTool || "" } };
  }
  return { ...c, config: { url: cfg.url || "" } };
}
function missionOut(m: Row) {
  const site = m.site || {};
  const { site: _s, ...rest } = m;
  return { ...rest, brand: site.brand, shots: site.render ? { desktop: site.render.desktopShot, mobile: site.render.mobileShot, full: site.render.fullShot, logo: site.render.logoFile } : null, running: A.live.get(m.id) || null };
}
const byIdDesc = (a: Row, b: Row) => b.id - a.id;

async function refreshPlugin(chId: number) {
  const ch = db.get("channels", chId)!;
  const st = A.getSettings();
  const key = cx.cxKey(st);
  const cfg = ch.config || {};
  const a = await cx.accountStatus(http, key, cfg.connectedAccountId);
  if (a.status === "ACTIVE") {
    if (!cx.pluginDef(cfg.toolkit) && !cfg.publishTool) {
      try {
        cfg.publishTool = await cx.pickPublishTool(http, st, key, cfg.toolkit);
        db.update("channels", ch.id, { config: { ...cfg } });
      } catch (e) {
        db.update("channels", ch.id, { status: "error", lastError: String((e as Error).message).slice(0, 300) });
        return db.get("channels", ch.id)!;
      }
    }
    const was = ch.status;
    db.update("channels", ch.id, { status: "connected", lastError: "" });
    if (was !== "connected") {
      for (const m of db.all("missions")) if (!(m.channelIds || []).includes(ch.id)) db.update("missions", m.id, { channelIds: [...(m.channelIds || []), ch.id] });
      A.notify({ title: `${ch.name} connected`, body: "Looi will publish your next approved ads here.", kind: "success" });
    }
  } else if (/FAILED|EXPIRED|INACTIVE/.test(a.status)) {
    db.update("channels", ch.id, { status: "error", lastError: `${a.status}${a.reason ? ": " + a.reason : ""}. Reconnect to fix.` });
  }
  return db.get("channels", ch.id)!;
}
/** Called on app resume: pick up OAuth connections finished in the system browser. */
export async function refreshPendingPlugins() {
  for (const c of db.where("channels", (x) => x.type === "composio" && x.status === "pending")) {
    try {
      await refreshPlugin(c.id);
    } catch {}
  }
}

type H = (p: Record<string, string>, body: any, q: URLSearchParams) => any | Promise<any>;
const routes: [string, RegExp, string[], H][] = [];
function on(method: string, path: string, h: H) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push([method, re, keys, h]);
}
const mission = (id: string) => {
  const m = db.get("missions", Number(id));
  if (!m) throw new HttpError(404, "Mission not found");
  return m;
};

on("GET", "/api/health", () => ({ ok: true, ts: Date.now(), device: true }));
on("GET", "/api/meta", () => ({ providers: Object.fromEntries(Object.entries(PROVIDERS)), channelTypes: CHANNEL_TYPES, formats: FORMATS, templates: TEMPLATES, builtinAvailable: false, device: true }));
on("GET", "/api/me", () => ({ saas: false, user: null, payments: false, trialDays: 0, plans: [], device: true }));

on("GET", "/api/settings", () => maskSettings(A.getSettings()));
on("PATCH", "/api/settings", (_p, b) => {
  const patch: any = { ...(b || {}) };
  for (const k of ["apiKey", "psiKey", "composioKey"]) if (patch[k] === "") delete patch[k];
  if (patch.clearComposioKey) patch.composioKey = "";
  if (patch.clearApiKey) patch.apiKey = "";
  delete patch.clearComposioKey;
  delete patch.clearApiKey;
  if (patch.provider && patch.provider !== "custom" && PROVIDERS[patch.provider] && !b.baseUrl) patch.baseUrl = PROVIDERS[patch.provider].baseUrl;
  if (patch.provider && patch.provider !== A.getSettings().provider && !b.model) patch.model = "";
  if (patch.intervalMinutes) patch.intervalMinutes = Math.min(Math.max(30, Number(patch.intervalMinutes)), 1440);
  return maskSettings(A.updateSettings(patch));
});
on("POST", "/api/settings/test", async () => {
  try {
    return await testProvider(http, A.getSettings());
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
on("GET", "/api/settings/models", async () => {
  try {
    return await listModels(http, A.getSettings());
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

on("GET", "/api/missions", () =>
  db
    .all("missions")
    .slice()
    .sort(byIdDesc)
    .map((m) => {
      const { report, brief, strategy, ...o } = missionOut(m) as any;
      return {
        ...o,
        oneLiner: m.brief?.product?.oneLiner || "",
        creativeCount: db.where("creatives", (c) => c.missionId === m.id && c.videoFile).length,
        postCount: db.where("posts", (p) => p.missionId === m.id && p.status === "published").length,
        clickCount: 0,
        scores: m.report?.lighthouse?.mobile?.scores || null,
      };
    }),
);
on("POST", "/api/missions", (_p, b) => {
  let url: string;
  try {
    url = normalizeUrl(String(b?.url || ""));
    if (!/\./.test(new URL(url).hostname)) throw 0;
  } catch {
    throw new HttpError(400, "Please enter a valid URL");
  }
  const st = A.getSettings();
  if (!hasAi(st)) throw new HttpError(400, "Add your free Groq or NVIDIA NIM key first (Settings → AI engine). The on-device agent uses it for the audit, copy and strategy.");
  const channelIds = b?.channelIds ?? db.where("channels", (c) => c.status === "connected").map((c) => c.id);
  const m = db.insert("missions", { url, name: new URL(url).hostname.replace(/^www\./, ""), favicon: "", status: "queued", stage: "Queued", progress: 0, mode: b?.mode || st.defaultMode, goal: b?.goal || "", channelIds, cycle: 0, site: {}, report: {}, brief: {}, strategy: {}, healthScore: 0, lastError: "", createdAt: Date.now(), lastCheckAt: 0, nextCheckAt: 0 });
  A.addEvent(m.id, "info", "Mission created", `Target: ${url} · running on this device`);
  A.enqueue(m.id, "launch", () => A.launchMission(m.id));
  return [missionOut(m), 201];
});
on("GET", "/api/missions/:id", (p) => {
  const m = mission(p.id);
  const site = m.site || {};
  return {
    ...missionOut(m),
    siteData: { ...site, bodyText: undefined, render: site.render ? { ...site.render, renderedText: undefined } : undefined },
    report: m.report || {},
    brief: m.brief || {},
    strategy: m.strategy || {},
    creatives: db.where("creatives", (c) => c.missionId === m.id).sort(byIdDesc),
    posts: db.where("posts", (x) => x.missionId === m.id).sort(byIdDesc).map((x) => ({ ...x, clicks: 0 })),
    events: db.where("events", (e) => e.missionId === m.id).sort(byIdDesc).slice(0, 200),
    snapshots: db.where("snapshots", (s) => s.missionId === m.id),
    playbooks: db.where("playbooks", (x) => x.missionId === m.id).sort(byIdDesc),
    approvals: db.where("approvals", (a) => a.missionId === m.id).sort(byIdDesc),
    clicksByDay: {},
    tracking: false,
    device: true,
  };
});
on("PATCH", "/api/missions/:id", (p, b) => {
  const m = mission(p.id);
  const patch: any = {};
  if (b.status === "paused" || b.status === "active") {
    patch.status = b.status;
    if (b.status === "active" && m.nextCheckAt < Date.now()) patch.nextCheckAt = Date.now() + 60000;
    A.addEvent(m.id, "info", b.status === "paused" ? "Mission paused by you" : "Mission resumed");
  }
  if (b.mode === "approval" || b.mode === "autopilot") patch.mode = b.mode;
  if (Array.isArray(b.channelIds)) patch.channelIds = b.channelIds.map(Number);
  if (typeof b.goal === "string") patch.goal = b.goal.slice(0, 500);
  return missionOut(db.update("missions", m.id, patch)!);
});
on("DELETE", "/api/missions/:id", (p) => {
  const m = mission(p.id);
  const files = db.where("creatives", (c) => c.missionId === m.id).flatMap((c) => [c.videoFile, c.posterFile]);
  const r = m.site?.render || {};
  void deleteMedia([...files, r.desktopShot, r.mobileShot, r.fullShot, r.logoFile]);
  for (const t of ["creatives", "posts", "events", "approvals", "playbooks", "snapshots"] as const) db.remove(t, (x) => x.missionId === m.id);
  db.remove("missions", (x) => x.id === m.id);
  return { ok: true };
});
on("POST", "/api/missions/:id/check", (p) => {
  const m = mission(p.id);
  if (m.status === "failed" || !m.brief?.product) {
    db.update("missions", m.id, { status: "queued", stage: "Queued" });
    A.enqueue(m.id, "launch", () => A.launchMission(m.id));
  } else A.enqueue(m.id, "check", () => A.checkMission(m.id, true));
  return { ok: true };
});
on("POST", "/api/missions/:id/generate", (p) => {
  const m = mission(p.id);
  A.enqueue(m.id, "generate", () => A.generateMore(m.id));
  return { ok: true };
});
on("POST", "/api/creatives/:id/publish", (p, b) => {
  const c = db.get("creatives", Number(p.id));
  if (!c) throw new HttpError(404, "Creative not found");
  const ids: number[] = (b?.channelIds || []).map(Number);
  if (!ids.length) throw new HttpError(400, "Pick at least one channel");
  db.update("creatives", c.id, { status: "approved" });
  A.enqueue(c.missionId, "publish", () => A.publishCreatives(c.missionId, [c.id], ids));
  return { ok: true };
});
on("POST", "/api/playbooks/:id/done", (p, b) => db.update("playbooks", Number(p.id), { status: b?.done ? "done" : "ready" }));

on("GET", "/api/live", () => {
  const jobs = [...A.live.values()];
  const queued = db.where("missions", (m) => m.status === "queued").map((m) => ({ missionId: m.id, name: m.name }));
  const approvals = db.where("approvals", (a) => a.status === "pending").sort(byIdDesc);
  const notes = db.all("notifications");
  return { jobs, queued, approvals, unread: notes.filter((n) => !n.read).length, latest: notes[notes.length - 1] || null, now: Date.now(), device: true };
});
on("GET", "/api/notifications", () => db.all("notifications").slice(-60).reverse());
on("POST", "/api/notifications/read", () => {
  for (const n of db.where("notifications", (x) => !x.read)) db.update("notifications", n.id, { read: true });
  return { ok: true };
});
on("GET", "/api/approvals", () =>
  db
    .all("approvals")
    .slice()
    .sort(byIdDesc)
    .slice(0, 100)
    .map((a) => ({ ...a, creatives: (a.payload?.creativeIds || []).map((id: number) => db.get("creatives", id)).filter(Boolean), missionName: db.get("missions", a.missionId)?.name || "" })),
);
on("POST", "/api/approvals/:id/decide", (p, b) => {
  const a = db.get("approvals", Number(p.id));
  if (!a) throw new HttpError(404, "Not found");
  if (a.status !== "pending") throw new HttpError(409, "Already decided");
  const approve = b?.decision === "approve";
  db.update("approvals", a.id, { status: approve ? "approved" : "rejected", decidedAt: Date.now() });
  if (approve) {
    A.addEvent(a.missionId, "success", "You approved publishing", a.title);
    A.enqueue(a.missionId, "publish", () => A.publishCreatives(a.missionId, a.payload?.creativeIds || [], a.payload?.channelIds || []));
  } else {
    (a.payload?.creativeIds || []).forEach((id: number) => db.update("creatives", id, { status: "rejected" }));
    A.addEvent(a.missionId, "warn", "You rejected this batch", "Strategist will try a different direction next cycle.");
  }
  return { ok: true };
});

// plugins
on("GET", "/api/plugins", () => {
  const st = A.getSettings();
  return { configured: !!cx.cxKey(st), source: st.composioKey ? "user" : st.relayComposio ? "server" : null, device: true, catalog: cx.PLUGINS.map((p) => ({ slug: p.slug, name: p.name, category: p.category, blurb: p.blurb, target: p.target || null, needsPublicMedia: !!p.needsPublicMedia, logo: cx.logo(p.slug) })) };
});
on("POST", "/api/plugins/verify", async (_p, b) => {
  try {
    return await cx.verifyKey(http, String(b?.key || cx.cxKey(A.getSettings())));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
on("GET", "/api/plugins/search", async (_p, _b, q) => {
  try {
    return await cx.searchToolkits(http, cx.cxKey(A.getSettings()), String(q.get("q") || "").slice(0, 60));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
on("POST", "/api/plugins/connect", async (_p, b) => {
  const toolkit = String(b?.toolkit || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!toolkit) throw new HttpError(400, "toolkit required");
  const def = cx.pluginDef(toolkit);
  const target = String(b?.target || "").slice(0, 300);
  if (def?.target?.required && !target) throw new HttpError(400, `${def.target.label} is required for ${def.name}`);
  try {
    const st = A.getSettings();
    const { redirectUrl, connectedAccountId } = await cx.createConnectLink(http, cx.cxKey(st), st.userId!, toolkit, "");
    const name = (def?.name || String(b?.name || toolkit)) + (target ? ` · ${target}` : "");
    const ch = db.insert("channels", { type: "composio", name: name.slice(0, 80), config: { toolkit, connectedAccountId, target, logo: String(b?.logo || "") }, status: "pending", lastError: "", createdAt: Date.now() });
    return [{ redirectUrl, channel: maskChannel(ch) }, 201];
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
on("POST", "/api/plugins/:id/refresh", async (p) => {
  const ch = db.get("channels", Number(p.id));
  if (!ch || ch.type !== "composio") throw new HttpError(404, "Not found");
  try {
    return maskChannel(await refreshPlugin(ch.id));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
on("PATCH", "/api/channels/:id", (p, b) => {
  const ch = db.get("channels", Number(p.id));
  if (!ch) throw new HttpError(404, "Not found");
  if (ch.type === "composio" && typeof b?.target === "string") {
    const cfg = { ...ch.config, target: b.target.slice(0, 300) };
    const def = cx.pluginDef(cfg.toolkit);
    db.update("channels", ch.id, { config: cfg, name: ((def?.name || cfg.toolkit) + (cfg.target ? ` · ${cfg.target}` : "")).slice(0, 80) });
  }
  return maskChannel(db.get("channels", ch.id)!);
});
on("GET", "/api/channels", () => db.all("channels").slice().sort(byIdDesc).map(maskChannel));
on("POST", "/api/channels", async (_p, b) => {
  const { type, name, config } = b || {};
  if (type !== "webhook") throw new HttpError(400, "Unknown channel type");
  if (!config?.url) throw new HttpError(400, "Webhook URL is required");
  let host = "webhook";
  try {
    host = new URL(config.url).hostname;
  } catch {}
  const ch = db.insert("channels", { type, name: name || `Webhook · ${host}`, config: { url: config.url }, status: "unverified", lastError: "", createdAt: Date.now() });
  try {
    const r = await http(config.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "looi.test", ts: Date.now() }) });
    if (!r.ok) throw new Error(`Webhook ${r.status}`);
    db.update("channels", ch.id, { status: "connected" });
  } catch (e) {
    db.update("channels", ch.id, { status: "error", lastError: String((e as Error).message).slice(0, 300) });
  }
  for (const m of db.all("missions")) if (!(m.channelIds || []).includes(ch.id)) db.update("missions", m.id, { channelIds: [...(m.channelIds || []), ch.id] });
  return [maskChannel(db.get("channels", ch.id)!), 201];
});
on("POST", "/api/channels/:id/test", async (p) => {
  const ch = db.get("channels", Number(p.id));
  if (!ch) throw new HttpError(404, "Not found");
  if (ch.type === "composio") {
    const c = await refreshPlugin(ch.id);
    if (c.status === "connected") return { ok: true, who: c.name };
    throw new HttpError(400, c.lastError || "Not connected yet — finish sign-in in the opened browser.");
  }
  const r = await http(ch.config.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "looi.test", ts: Date.now() }) }).catch((e) => ({ ok: false, status: 0, text: String(e) }) as any);
  if (!r.ok) {
    db.update("channels", ch.id, { status: "error", lastError: `Webhook ${r.status}` });
    throw new HttpError(400, `Webhook ${r.status}`);
  }
  db.update("channels", ch.id, { status: "connected", lastError: "" });
  return { ok: true, who: "Webhook responded " + r.status };
});
on("DELETE", "/api/channels/:id", (p) => {
  const ch = db.get("channels", Number(p.id));
  if (!ch) throw new HttpError(404, "Not found");
  if (ch.type === "composio" && ch.config?.connectedAccountId) void cx.deleteAccount(http, cx.cxKey(A.getSettings()), ch.config.connectedAccountId);
  db.remove("channels", (x) => x.id === ch.id);
  return { ok: true };
});

export async function localFetch(method: string, url: string, body?: any): Promise<Response> {
  const u = new URL(url, "https://looi.local");
  for (const [m, re, keys, h] of routes) {
    if (m !== method) continue;
    const mm = u.pathname.match(re);
    if (!mm) continue;
    const params: Record<string, string> = {};
    keys.forEach((k, i) => (params[k] = decodeURIComponent(mm[i + 1])));
    try {
      const out = await h(params, body || {}, u.searchParams);
      return Array.isArray(out) && out.length === 2 && typeof out[1] === "number" ? json(out[0], out[1]) : json(out);
    } catch (e) {
      const st = e instanceof HttpError ? e.status : 500;
      return json({ message: (e as Error).message || "Error" }, st);
    }
  }
  return json({ message: `No on-device route for ${method} ${u.pathname}` }, 404);
}
