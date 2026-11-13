import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { storage } from "./storage";
import { insertMissionSchema, updateSettingsSchema } from "@shared/schema";
import { normalizeUrl, mediaPath } from "./agent/analyze";
import { ensureMedia, startPersistence } from "./persist";
import { PROVIDERS, testProvider, listModels, builtinAvailable } from "./agent/llm";
import { CHANNEL_TYPES, verifyChannel } from "./agent/publish";
import { FORMATS, TEMPLATES } from "./agent/render";
import * as cx from "./agent/composio";
import * as billing from "./billing";
import dns from "node:dns/promises";
import net from "node:net";
import { enqueue, launchMission, checkMission, generateMore, publishCreatives, live, startScheduler, publicBase } from "./agent/agent";

function owner(req: Request) {
  if ((req as any).ownerId) return (req as any).ownerId as string;
  const d = (req.header("x-looi-device") || "").trim();
  if (d && /^[\w-]{8,80}$/.test(d)) return "dev-" + d;
  return (req.header("x-visitor-id") || "local").slice(0, 120);
}
/** Block private / internal targets so a public server can't be used to probe its own network. */
function privateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}
async function assertPublicUrl(u: string) {
  if (!billing.SAAS) return;
  const host = new URL(u).hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("private");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(privateIp)) throw new Error("private");
}
function sendLimit(res: Response, e: unknown) {
  if (e instanceof billing.LimitError) return res.status(402).json({ message: e.message, upgrade: true });
  throw e;
}
const J = (s: string, d: any = {}) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
function maskSettings(s: any) {
  const { apiKey, psiKey, composioKey, ...rest } = s;
  return { ...rest, hasComposioKey: !!composioKey, composioKeyHint: composioKey ? "••••" + composioKey.slice(-4) : "", composioServer: !!process.env.COMPOSIO_API_KEY, hasApiKey: !!apiKey, apiKeyHint: apiKey ? "••••" + apiKey.slice(-4) : "", hasPsiKey: !!psiKey, builtinAvailable: builtinAvailable() };
}
function maskChannel(c: any) {
  const cfg = J(c.config);
  if (c.type === "composio") {
    const def = cx.pluginDef(cfg.toolkit);
    return { ...c, config: { toolkit: cfg.toolkit, target: cfg.target || "", logo: cfg.logo || cx.logo(cfg.toolkit), tool: def ? (def.stepsWithImage || def.steps).join(" → ") : cfg.publishTool || "" } };
  }
  const def = CHANNEL_TYPES[c.type];
  const safe: Record<string, string> = {};
  for (const f of def?.fields || []) safe[f.key] = f.secret ? (cfg[f.key] ? "••••" + String(cfg[f.key]).slice(-4) : "") : cfg[f.key] || "";
  return { ...c, config: safe };
}
function missionOut(m: any) {
  const site = J(m.site);
  return {
    ...m,
    site: undefined,
    channelIds: J(m.channelIds, []),
    brand: site.brand,
    shots: site.render ? { desktop: site.render.desktopShot, mobile: site.render.mobileShot, full: site.render.fullShot, logo: site.render.logoFile } : null,
    running: live.get(m.id) || null,
  };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  startPersistence();
  // Behind the Cloudflare Worker: learn the public origin from the first real request (tracked links, OAuth callbacks)
  app.use((req, _res, next) => {
    const o = req.header("x-looi-origin");
    if (o && !process.env.LOOI_PUBLIC_URL && /^https:\/\/[a-z0-9.-]+$/i.test(o)) process.env.LOOI_PUBLIC_URL = o;
    next();
  });
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Looi-Device, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  billing.installAuth(app);

  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.get("/api/meta", (_req, res) =>
    res.json({
      providers: PROVIDERS,
      channelTypes: CHANNEL_TYPES,
      formats: FORMATS,
      templates: TEMPLATES,
      builtinAvailable: builtinAvailable(),
    }),
  );

  // ---------- settings
  app.get("/api/settings", (req, res) => res.json(maskSettings(storage.getSettings(owner(req)))));
  app.patch("/api/settings", (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const patch: any = { ...parsed.data };
    if (patch.apiKey === "") delete patch.apiKey; // keep existing unless explicitly cleared
    if (patch.psiKey === "") delete patch.psiKey;
    if (patch.composioKey === "") delete patch.composioKey;
    if (req.body.clearComposioKey) patch.composioKey = "";
    if (req.body.clearApiKey) patch.apiKey = "";
    if (patch.provider && patch.provider !== "custom" && PROVIDERS[patch.provider] && !req.body.baseUrl) patch.baseUrl = PROVIDERS[patch.provider].baseUrl;
    if (patch.intervalMinutes) patch.intervalMinutes = Math.min(Math.max(30, patch.intervalMinutes), 1440);
    res.json(maskSettings(storage.updateSettings(owner(req), patch)));
  });
  app.post("/api/settings/test", async (req, res) => {
    try {
      res.json(await testProvider(storage.getSettings(owner(req))));
    } catch (e) {
      res.status(400).json({ ok: false, message: String((e as Error).message) });
    }
  });
  app.get("/api/settings/models", async (req, res) => {
    try {
      res.json(await listModels(storage.getSettings(owner(req))));
    } catch (e) {
      res.status(400).json({ message: String((e as Error).message) });
    }
  });

  // ---------- missions
  app.get("/api/missions", (req, res) => {
    const list = storage.listMissions(owner(req)).map((m) => {
      const posts = storage.listPosts(m.id);
      return {
        ...missionOut(m),
        report: undefined,
        brief: undefined,
        strategy: undefined,
        oneLiner: J(m.brief).product?.oneLiner || "",
        creativeCount: storage.listCreatives(m.id).filter((c) => c.videoFile).length,
        postCount: posts.filter((p) => p.status === "published").length,
        clickCount: storage.clicksFor(m.id).length,
        scores: J(m.report).lighthouse?.mobile?.scores || null,
      };
    });
    res.json(list);
  });
  app.post("/api/missions", async (req, res) => {
    const parsed = insertMissionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Please enter a valid URL" });
    let url: string;
    try {
      url = normalizeUrl(parsed.data.url);
    } catch {
      return res.status(400).json({ message: "Please enter a valid URL" });
    }
    try {
      await assertPublicUrl(url);
    } catch {
      return res.status(400).json({ message: "That address isn't reachable on the public internet. Enter your live website or app URL." });
    }
    const o = owner(req);
    try {
      billing.assertCanLaunch(o);
    } catch (e) {
      return sendLimit(res, e);
    }
    const st = storage.getSettings(o);
    const channelIds = parsed.data.channelIds ?? storage.listChannels(o).filter((c) => c.status === "connected").map((c) => c.id);
    const m = storage.createMission(o, { url, name: new URL(url).hostname.replace(/^www\./, ""), mode: parsed.data.mode || st.defaultMode, goal: parsed.data.goal || "", channelIds: JSON.stringify(channelIds), status: "queued", stage: "Queued" });
    storage.addEvent(o, m.id, "info", "Mission created", `Target: ${url}`);
    enqueue(m.id, "launch", () => launchMission(m.id));
    res.status(201).json(missionOut(m));
  });
  app.get("/api/missions/:id", (req, res) => {
    const m = storage.getMission(Number(req.params.id));
    if (!m || m.ownerId !== owner(req)) return res.status(404).json({ message: "Mission not found" });
    const site = J(m.site);
    const posts = storage.listPosts(m.id);
    const clicks = storage.clicksFor(m.id);
    res.json({
      ...missionOut(m),
      siteData: { ...site, bodyText: undefined, render: site.render ? { ...site.render, renderedText: undefined } : undefined },
      report: J(m.report),
      brief: J(m.brief),
      strategy: J(m.strategy),
      creatives: storage.listCreatives(m.id).map((c) => ({ ...c, copy: J(c.copy) })),
      posts: posts.map((p) => ({ ...p, metrics: J(p.metrics), clicks: clicks.filter((k) => k.linkCode === p.linkCode).length })),
      events: storage.listEvents(m.id),
      snapshots: storage.listSnapshots(m.id).map((s) => ({ ...s, data: J(s.data) })),
      playbooks: storage.listPlaybooks(m.id),
      approvals: storage.listApprovals(m.ownerId).filter((a) => a.missionId === m.id).map((a) => ({ ...a, payload: J(a.payload) })),
      clicksByDay: clicks.reduce((acc: Record<string, number>, k) => {
        const d = new Date(k.ts).toISOString().slice(0, 10);
        acc[d] = (acc[d] || 0) + 1;
        return acc;
      }, {}),
      tracking: !!publicBase(storage.getSettings(m.ownerId)),
    });
  });
  app.patch("/api/missions/:id", (req, res) => {
    const m = storage.getMission(Number(req.params.id));
    if (!m || m.ownerId !== owner(req)) return res.status(404).json({ message: "Mission not found" });
    const patch: any = {};
    if (req.body.status === "active" && (m.status === "paused" || m.status === "failed")) {
      try {
        billing.assertCanLaunch(m.ownerId);
      } catch (e) {
        if (!(e instanceof billing.LimitError) || /active mission/.test(e.message)) return sendLimit(res, e);
      }
    }
    if (req.body.mode === "autopilot" && !billing.autopilotAllowed(m.ownerId)) return res.status(402).json({ message: "Autopilot is part of Pro. Your Free plan publishes after your approval.", upgrade: true });
    if (req.body.status === "paused" || req.body.status === "active") {
      patch.status = req.body.status;
      if (req.body.status === "active" && m.nextCheckAt < Date.now()) patch.nextCheckAt = Date.now() + 60000;
      storage.addEvent(m.ownerId, m.id, "info", req.body.status === "paused" ? "Mission paused by you" : "Mission resumed");
    }
    if (req.body.mode === "approval" || req.body.mode === "autopilot") patch.mode = req.body.mode;
    if (Array.isArray(req.body.channelIds)) patch.channelIds = JSON.stringify(req.body.channelIds.map(Number));
    if (typeof req.body.goal === "string") patch.goal = req.body.goal.slice(0, 500);
    res.json(missionOut(storage.updateMission(m.id, patch)));
  });
  app.delete("/api/missions/:id", (req, res) => {
    const m = storage.getMission(Number(req.params.id));
    if (!m || m.ownerId !== owner(req)) return res.status(404).json({ message: "Mission not found" });
    storage.deleteMission(m.id);
    res.json({ ok: true });
  });
  app.post("/api/missions/:id/check", (req, res) => {
    const m = storage.getMission(Number(req.params.id));
    if (!m || m.ownerId !== owner(req)) return res.status(404).json({ message: "Mission not found" });
    const { plan } = billing.planFor(m.ownerId);
    if (billing.SAAS && m.lastCheckAt && Date.now() - m.lastCheckAt < Math.min(plan.minInterval, 240) * 60000 / 4)
      return res.status(429).json({ message: `Looi just checked this site. On ${plan.label} you can re-check every ${Math.round(Math.min(plan.minInterval, 240) / 4)} minutes.`, upgrade: plan.key === "free" });
    if (m.status === "failed" || !m.brief || m.brief === "{}") {
      storage.updateMission(m.id, { status: "queued", stage: "Queued" });
      enqueue(m.id, "launch", () => launchMission(m.id));
    } else enqueue(m.id, "check", () => checkMission(m.id, true));
    res.json({ ok: true });
  });
  app.post("/api/missions/:id/generate", (req, res) => {
    const m = storage.getMission(Number(req.params.id));
    if (!m || m.ownerId !== owner(req)) return res.status(404).json({ message: "Mission not found" });
    try {
      billing.assertCanCreate(m.ownerId);
    } catch (e) {
      return sendLimit(res, e);
    }
    enqueue(m.id, "generate", () => generateMore(m.id));
    res.json({ ok: true });
  });
  app.post("/api/creatives/:id/publish", (req, res) => {
    const c = storage.getCreative(Number(req.params.id));
    if (!c || c.ownerId !== owner(req)) return res.status(404).json({ message: "Creative not found" });
    const ids: number[] = (req.body.channelIds || []).map(Number);
    if (!ids.length) return res.status(400).json({ message: "Pick at least one channel" });
    storage.updateCreative(c.id, { status: "approved" });
    enqueue(c.missionId, "publish", () => publishCreatives(c.missionId, [c.id], ids));
    res.json({ ok: true });
  });
  app.post("/api/playbooks/:id/done", (req, res) => {
    res.json(storage.updatePlaybook(Number(req.params.id), { status: req.body.done ? "done" : "ready" }));
  });

  // ---------- live state for the pill + notifications
  app.get("/api/live", (req, res) => {
    const o = owner(req);
    const jobs = [...live.values()].filter((j) => j.ownerId === o);
    const queuedMissions = storage.listMissions(o).filter((m) => m.status === "queued").map((m) => ({ missionId: m.id, name: m.name }));
    const approvals = storage.listApprovals(o, "pending").map((a) => ({ ...a, payload: J(a.payload) }));
    const latest = storage.listNotifications(o, 1)[0] || null;
    res.json({ jobs, queued: queuedMissions, approvals, unread: storage.unreadCount(o), latest, now: Date.now() });
  });
  app.get("/api/notifications", (req, res) => res.json(storage.listNotifications(owner(req))));
  app.post("/api/notifications/read", (req, res) => {
    storage.markAllRead(owner(req));
    res.json({ ok: true });
  });
  app.get("/api/approvals", (req, res) => {
    const o = owner(req);
    res.json(
      storage.listApprovals(o).map((a) => {
        const p = J(a.payload);
        return { ...a, payload: p, creatives: (p.creativeIds || []).map((id: number) => storage.getCreative(id)).filter(Boolean).map((c: any) => ({ ...c, copy: J(c.copy) })), missionName: storage.getMission(a.missionId)?.name || "" };
      }),
    );
  });
  app.post("/api/approvals/:id/decide", (req, res) => {
    const a = storage.getApproval(Number(req.params.id));
    if (!a || a.ownerId !== owner(req)) return res.status(404).json({ message: "Not found" });
    if (a.status !== "pending") return res.status(409).json({ message: "Already decided" });
    const approve = req.body.decision === "approve";
    storage.decideApproval(a.id, approve ? "approved" : "rejected");
    const p = J(a.payload);
    if (approve) {
      storage.addEvent(a.ownerId, a.missionId, "success", "You approved publishing", a.title);
      enqueue(a.missionId, "publish", () => publishCreatives(a.missionId, p.creativeIds || [], p.channelIds || []));
    } else {
      (p.creativeIds || []).forEach((id: number) => storage.updateCreative(id, { status: "rejected" }));
      storage.addEvent(a.ownerId, a.missionId, "warn", "You rejected this batch", "Strategist will try a different direction next cycle.");
    }
    res.json({ ok: true });
  });

  // ---------- plugins (Composio one-click connect)
  const attachToMissions = (o: string, chId: number) => {
    for (const m of storage.listMissions(o)) {
      const ids: number[] = J(m.channelIds, []);
      if (!ids.includes(chId)) storage.updateMission(m.id, { channelIds: JSON.stringify([...ids, chId]) });
    }
  };
  const refreshPlugin = async (chId: number) => {
    const ch = storage.getChannel(chId)!;
    const st = storage.getSettings(ch.ownerId);
    const key = cx.composioKey(st);
    const cfg = J(ch.config);
    const a = await cx.accountStatus(key, cfg.connectedAccountId);
    if (a.status === "ACTIVE") {
      if (!cx.pluginDef(cfg.toolkit) && !cfg.publishTool) {
        try {
          cfg.publishTool = await cx.pickPublishTool(st, key, cfg.toolkit);
          storage.updateChannel(ch.id, { config: JSON.stringify(cfg) });
        } catch (e) {
          storage.updateChannel(ch.id, { status: "error", lastError: String((e as Error).message).slice(0, 300) });
          return storage.getChannel(ch.id)!;
        }
      }
      const was = ch.status;
      storage.updateChannel(ch.id, { status: "connected", lastError: "" });
      if (was !== "connected") {
        attachToMissions(ch.ownerId, ch.id);
        storage.notify(ch.ownerId, { title: `${ch.name} connected`, body: "Looi will publish your next approved ads here.", kind: "success" });
      }
    } else if (/FAILED|EXPIRED|INACTIVE/.test(a.status)) {
      storage.updateChannel(ch.id, { status: "error", lastError: `${a.status}${a.reason ? ": " + a.reason : ""}. Reconnect to fix.` });
    }
    return storage.getChannel(ch.id)!;
  };

  app.get("/api/plugins", (req, res) => {
    const st = storage.getSettings(owner(req));
    res.json({ configured: !!cx.composioKey(st), source: st.composioKey ? "user" : process.env.COMPOSIO_API_KEY ? "server" : null, catalog: cx.PLUGINS.map((p) => ({ slug: p.slug, name: p.name, category: p.category, blurb: p.blurb, target: p.target || null, needsPublicMedia: !!p.needsPublicMedia, logo: cx.logo(p.slug) })) });
  });
  app.post("/api/plugins/verify", async (req, res) => {
    const key = String(req.body?.key || cx.composioKey(storage.getSettings(owner(req))));
    try {
      res.json(await cx.verifyKey(key));
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });
  app.get("/api/plugins/search", async (req, res) => {
    try {
      res.json(await cx.searchToolkits(cx.composioKey(storage.getSettings(owner(req))), String(req.query.q || "").slice(0, 60)));
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });
  app.post("/api/plugins/connect", async (req, res) => {
    const o = owner(req);
    const toolkit = String(req.body?.toolkit || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!toolkit) return res.status(400).json({ message: "toolkit required" });
    const def = cx.pluginDef(toolkit);
    const target = String(req.body?.target || "").slice(0, 300);
    if (def?.target?.required && !target) return res.status(400).json({ message: `${def.target.label} is required for ${def.name}` });
    try {
      const st = storage.getSettings(o);
      const { redirectUrl, connectedAccountId } = await cx.createConnectLink(cx.composioKey(st), o, toolkit, String(req.body?.callbackUrl || ""));
      const name = (def?.name || String(req.body?.name || toolkit)) + (target ? ` · ${target}` : "");
      const ch = storage.createChannel(o, { type: "composio", name: name.slice(0, 80), config: JSON.stringify({ toolkit, connectedAccountId, target, logo: String(req.body?.logo || "") }) });
      storage.updateChannel(ch.id, { status: "pending" });
      res.status(201).json({ redirectUrl, channel: maskChannel(storage.getChannel(ch.id)) });
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });
  app.post("/api/plugins/:id/refresh", async (req, res) => {
    const ch = storage.getChannel(Number(req.params.id));
    if (!ch || ch.ownerId !== owner(req) || ch.type !== "composio") return res.status(404).json({ message: "Not found" });
    try {
      res.json(maskChannel(await refreshPlugin(ch.id)));
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });
  app.patch("/api/channels/:id", (req, res) => {
    const ch = storage.getChannel(Number(req.params.id));
    if (!ch || ch.ownerId !== owner(req)) return res.status(404).json({ message: "Not found" });
    if (ch.type === "composio" && typeof req.body?.target === "string") {
      const cfg = J(ch.config);
      cfg.target = req.body.target.slice(0, 300);
      const def = cx.pluginDef(cfg.toolkit);
      storage.updateChannel(ch.id, { config: JSON.stringify(cfg), name: ((def?.name || cfg.toolkit) + (cfg.target ? ` · ${cfg.target}` : "")).slice(0, 80) });
    }
    res.json(maskChannel(storage.getChannel(ch.id)));
  });
  app.get("/api/plugins/callback", (_req, res) => {
    res.type("html").send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Connected · Looi</title><body style="background:#0b0c0e;color:#e8e8e3;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:320px"><div style="width:44px;height:44px;border-radius:50%;background:#c6ff3a;margin:0 auto 16px"></div><h1 style="font-size:20px;margin:0 0 8px">Account connected</h1><p style="color:#9a9a93;margin:0">You can close this tab and go back to Looi. It will pick up the connection automatically.</p></div><script>setTimeout(()=>{try{window.close()}catch(e){}},1500)</script>`);
  });

  // ---------- channels
  app.get("/api/channels", (req, res) => res.json(storage.listChannels(owner(req)).map(maskChannel)));
  app.post("/api/channels", async (req, res) => {
    const { type, name, config } = req.body || {};
    const def = CHANNEL_TYPES[type];
    if (!def) return res.status(400).json({ message: "Unknown channel type" });
    for (const f of def.fields) if (!config?.[f.key]) return res.status(400).json({ message: `${f.label} is required` });
    const o = owner(req);
    const ch = storage.createChannel(o, { type, name: name || def.label, config: JSON.stringify(config) });
    try {
      const who = await verifyChannel(ch);
      storage.updateChannel(ch.id, { status: "connected", lastError: "", name: name || (type === "webhook" || /responded|ok/i.test(String(who)) ? `${def.label.split(" (")[0]} · ${(() => { try { return new URL(config.url || config.webhookUrl).hostname; } catch { return "connected"; } })()}` : `${def.label} · ${who}`).slice(0, 80) });
    } catch (e) {
      storage.updateChannel(ch.id, { status: "error", lastError: String((e as Error).message).slice(0, 300) });
    }
    // attach to all active missions of this owner
    for (const m of storage.listMissions(o)) {
      const ids: number[] = J(m.channelIds, []);
      if (!ids.includes(ch.id)) storage.updateMission(m.id, { channelIds: JSON.stringify([...ids, ch.id]) });
    }
    res.status(201).json(maskChannel(storage.getChannel(ch.id)));
  });
  app.post("/api/channels/:id/test", async (req, res) => {
    const ch = storage.getChannel(Number(req.params.id));
    if (!ch || ch.ownerId !== owner(req)) return res.status(404).json({ message: "Not found" });
    if (ch.type === "composio") {
      try {
        const c = await refreshPlugin(ch.id);
        return c.status === "connected" ? res.json({ ok: true, who: c.name }) : res.status(400).json({ ok: false, message: c.lastError || "Not connected yet — finish sign-in in the opened tab." });
      } catch (e) {
        return res.status(400).json({ ok: false, message: (e as Error).message });
      }
    }
    try {
      const who = await verifyChannel(ch);
      storage.updateChannel(ch.id, { status: "connected", lastError: "" });
      res.json({ ok: true, who });
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 300);
      storage.updateChannel(ch.id, { status: "error", lastError: msg });
      res.status(400).json({ ok: false, message: msg });
    }
  });
  app.delete("/api/channels/:id", (req, res) => {
    const ch = storage.getChannel(Number(req.params.id));
    if (!ch || ch.ownerId !== owner(req)) return res.status(404).json({ message: "Not found" });
    if (ch.type === "composio") {
      const cfg = J(ch.config);
      if (cfg.connectedAccountId) void cx.deleteAccount(cx.composioKey(storage.getSettings(ch.ownerId)), cfg.connectedAccountId);
    }
    storage.deleteChannel(ch.id);
    res.json({ ok: true });
  });

  // ---------- media
  const sendMedia = async (req: Request, res: Response) => {
    const f = path.basename(String(req.params.file));
    const p = mediaPath(f);
    if (!fs.existsSync(p) && !(await ensureMedia(f))) return res.status(404).end();
    if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename="looi-${f}"`);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(p);
  };
  app.get("/api/media/:file", sendMedia);
  app.get("/api/public/media/:file", sendMedia);

  // ---------- tracked redirect links
  app.get("/r/:code", (req, res) => {
    const post = storage.postByCode(String(req.params.code));
    if (!post) return res.status(404).send("Link not found");
    const m = storage.getMission(post.missionId);
    if (!m) return res.status(404).send("Link not found");
    storage.addClick({ linkCode: post.linkCode, missionId: m.id, postId: post.id, kind: "click", ts: Date.now(), referrer: String(req.header("referer") || "").slice(0, 300), ua: String(req.header("user-agent") || "").slice(0, 300) });
    const u = new URL(m.url);
    u.searchParams.set("utm_source", post.channelType);
    u.searchParams.set("utm_medium", "social");
    u.searchParams.set("utm_campaign", `looi-${m.id}`);
    u.searchParams.set("utm_content", post.linkCode);
    res.redirect(302, u.toString());
  });

  startScheduler();
  return httpServer;
}
