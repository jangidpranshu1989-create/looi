import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { storage } from "./storage";
import { insertMissionSchema, updateSettingsSchema } from "@shared/schema";
import { normalizeUrl, mediaPath } from "./agent/analyze";
import { PROVIDERS, testProvider, listModels, builtinAvailable } from "./agent/llm";
import { CHANNEL_TYPES, verifyChannel } from "./agent/publish";
import { FORMATS, TEMPLATES } from "./agent/render";
import { enqueue, launchMission, checkMission, generateMore, publishCreatives, live, startScheduler, publicBase } from "./agent/agent";

function owner(req: Request) {
  const d = (req.header("x-looi-device") || "").trim();
  if (d && /^[\w-]{8,80}$/.test(d)) return "dev-" + d;
  return (req.header("x-visitor-id") || "local").slice(0, 120);
}
const J = (s: string, d: any = {}) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
function maskSettings(s: any) {
  const { apiKey, psiKey, ...rest } = s;
  return { ...rest, hasApiKey: !!apiKey, apiKeyHint: apiKey ? "••••" + apiKey.slice(-4) : "", hasPsiKey: !!psiKey, builtinAvailable: builtinAvailable() };
}
function maskChannel(c: any) {
  const def = CHANNEL_TYPES[c.type];
  const cfg = J(c.config);
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
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Looi-Device");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

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
  app.post("/api/missions", (req, res) => {
    const parsed = insertMissionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Please enter a valid URL" });
    let url: string;
    try {
      url = normalizeUrl(parsed.data.url);
    } catch {
      return res.status(400).json({ message: "Please enter a valid URL" });
    }
    const o = owner(req);
    const st = storage.getSettings(o);
    const channelIds = parsed.data.channelIds ?? storage.listChannels(o).map((c) => c.id);
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
    if (m.status === "failed" || !m.brief || m.brief === "{}") {
      storage.updateMission(m.id, { status: "queued", stage: "Queued" });
      enqueue(m.id, "launch", () => launchMission(m.id));
    } else enqueue(m.id, "check", () => checkMission(m.id, true));
    res.json({ ok: true });
  });
  app.post("/api/missions/:id/generate", (req, res) => {
    const m = storage.getMission(Number(req.params.id));
    if (!m || m.ownerId !== owner(req)) return res.status(404).json({ message: "Mission not found" });
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
    storage.deleteChannel(ch.id);
    res.json({ ok: true });
  });

  // ---------- media
  const sendMedia = (req: Request, res: Response) => {
    const f = path.basename(String(req.params.file));
    const p = mediaPath(f);
    if (!fs.existsSync(p)) return res.status(404).end();
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
