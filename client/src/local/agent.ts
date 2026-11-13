/** On-device Looi agent: same pipeline as server/agent/agent.ts, running entirely on the phone. */
import { db, type Row } from "./db";
import { http } from "./net";
import { DEFAULT_SETTINGS, type Settings } from "./core/types";
import { chatJson } from "./core/llm";
import { publishComposio } from "./core/composio";
import { reportPrompt, briefPrompt, strategistPrompt, captionFor, capKeyFor, utmLink, randCode, computeHealth, TEMPLATES, type FormatKey, type TemplateKey } from "./core/marketing";
import { fetchSite, runPsi, captureFromPsi, deriveBrand, type SiteData } from "./analyze";
import { renderAdLocal } from "./adrender";
import { getMediaUrl, getMedia, blobToB64 } from "./media";

export interface LiveJob {
  missionId: number;
  name: string;
  favicon: string;
  kind: "launch" | "check" | "generate" | "publish";
  stage: string;
  progress: number;
  startedAt: number;
  steps: { label: string; done: boolean }[];
}
export const live = new Map<number, LiveJob>();

// ---------- settings
export function getSettings(): Settings {
  let s = db.kvGet("settings");
  if (!s) {
    s = { ...DEFAULT_SETTINGS, userId: "u" + Math.random().toString(36).slice(2) + Date.now().toString(36) };
    db.kvSet("settings", s);
  }
  if (!s.userId) {
    s.userId = "u" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    db.kvSet("settings", s);
  }
  return { ...DEFAULT_SETTINGS, ...s, ...relayInfo() };
}
/** Looi Free relay discovered at boot (window.__LOOI__.relay + /relay/status). */
function relayInfo(): Partial<Settings> {
  const L: any = typeof window !== "undefined" ? (window as any).__LOOI__ : null;
  if (!L?.relay) return { relayUrl: "", relayAi: false, relayComposio: false };
  return { relayUrl: L.relay, deviceId: L.device || "", relayAi: !!L.relayCaps?.ai, relayComposio: !!L.relayCaps?.composio };
}
export function updateSettings(patch: Partial<Settings>) {
  const { relayUrl, deviceId, relayAi, relayComposio, ...s } = { ...getSettings(), ...patch } as Settings;
  db.kvSet("settings", s);
  onStateChange();
  return getSettings();
}

// ---------- helpers
const now = () => Date.now();
export const getMission = (id: number) => db.get("missions", id);
const upd = (id: number, p: Record<string, any>) => db.update("missions", id, p)!;
export function addEvent(missionId: number, kind: string, title: string, detail = "") {
  return db.insert("events", { missionId, kind, title, detail, ts: now() });
}
export function notify(v: { title: string; body?: string; kind?: string; missionId?: number; approvalId?: number }) {
  const n = db.insert("notifications", { ts: now(), body: "", kind: "info", missionId: 0, approvalId: 0, read: false, ...v });
  nativeNotify(n);
  return n;
}
function nativeNotify(n: Row) {
  const LN = (window as any).Capacitor?.Plugins?.LocalNotifications;
  if (!LN || !(window as any).Capacitor?.isNativePlatform?.()) return;
  if (document.visibilityState === "visible" && n.kind !== "approval") return;
  LN.schedule({ notifications: [{ id: (n.id % 2_000_000) + 1000, title: n.title, body: n.body || "", extra: { missionId: n.missionId, approvalId: n.approvalId } }] }).catch(() => {});
}
let stateListener: (() => void) | null = null;
export const setStateListener = (f: () => void) => (stateListener = f);
let stTimer: any;
function onStateChange() {
  clearTimeout(stTimer);
  stTimer = setTimeout(() => stateListener?.(), 400);
}

function setStage(job: LiveJob, stage: string, progress: number) {
  const idx = job.steps.findIndex((s) => s.label === stage);
  if (idx >= 0) job.steps.forEach((s, i) => (s.done = i < idx));
  job.stage = stage;
  job.progress = progress;
  upd(job.missionId, { stage, progress });
  addEvent(job.missionId, "step", stage);
}

export function brandFor(m: Row) {
  const site = m.site || {};
  const b = site.brand || {};
  const r = site.render || {};
  return {
    name: m.brief?.product?.name || m.name,
    domain: new URL(m.url).hostname.replace(/^www\./, ""),
    primary: b.primary || "hsl(262 85% 60%)",
    dark: b.dark || "hsl(262 45% 7%)",
    light: b.light || "hsl(262 60% 96%)",
    logo: getMediaUrl(r.logoFile),
    logoTone: r.logoTone,
    desktop: getMediaUrl(r.desktopShot),
    mobile: getMediaUrl(r.mobileShot),
    full: getMediaUrl(r.fullShot),
  };
}

/** Render a creative. Creative rows may already exist (created by the background runner with status needs-render). */
export async function renderCreative(cr: Row, job?: LiveJob) {
  const m = getMission(cr.missionId);
  if (!m) return cr;
  db.update("creatives", cr.id, { status: "rendering" });
  try {
    const base = `m${m.id}-c${cr.id}-${Math.random().toString(36).slice(2, 8)}`;
    const { video, poster } = await renderAdLocal(cr.template as TemplateKey, cr.format as FormatKey, brandFor(m), cr.copy, base, (p) => {
      if (job) job.stage = job.stage.replace(/ \d+%$/, "") + ` ${Math.round(p * 100)}%`;
    });
    return db.update("creatives", cr.id, { videoFile: video, posterFile: poster, status: "draft" })!;
  } catch (e) {
    addEvent(m.id, "error", "Ad render failed", String((e as Error).message));
    return db.update("creatives", cr.id, { status: "failed" })!;
  }
}

function createCreative(m: Row, cycle: number, angle: any, template: TemplateKey, format: FormatKey) {
  return db.insert("creatives", { missionId: m.id, cycle, angle: angle.name || "", template, format, copy: angle, posterFile: "", videoFile: "", status: "rendering", createdAt: now() });
}

// ---------- publishing
/** Public link for a rendered ad via the Looi Free relay (Instagram & co. fetch media by URL). Cached ~6 days. */
async function publicLink(st: Settings, crId: number, file: string, field: "pubPoster" | "pubVideo"): Promise<string> {
  if (!st.relayUrl || !file) return "";
  const cr = db.get("creatives", crId);
  const cached = cr?.[field];
  if (cached?.url && cached.until > now()) return cached.url;
  const blob = await getMedia(file);
  if (!blob || blob.size > 24 * 1024 * 1024) return "";
  try {
    const r = await fetch(`${st.relayUrl.replace(/\/$/, "")}/relay/media`, { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg", "X-Looi-Device": st.deviceId || st.userId || "" }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) return "";
    db.update("creatives", crId, { [field]: { url: j.url, until: now() + 6 * 86400_000 } });
    return j.url as string;
  } catch {
    return "";
  }
}
export async function publishCreatives(missionId: number, creativeIds: number[], channelIds: number[]) {
  const m = getMission(missionId);
  if (!m) return;
  const st = getSettings();
  const results: string[] = [];
  for (const cid of creativeIds) {
    const cr = db.get("creatives", cid);
    if (!cr) continue;
    const copy = cr.copy || {};
    for (const chId of channelIds) {
      const ch = db.get("channels", chId);
      if (!ch || ch.status === "pending") continue;
      const tk = ch.type === "composio" ? ch.config.toolkit || "composio" : ch.type;
      const code = randCode();
      const link = utmLink(m.url, m.id, code, tk);
      const post = db.insert("posts", { missionId: m.id, creativeId: cr.id, channelId: ch.id, channelType: tk, linkCode: code, externalId: "", externalUrl: "", status: "queued", error: "", metrics: {}, publishedAt: 0 });
      try {
        const caption = captionFor(capKeyFor(tk), copy.captions || {}, link, copy.hashtags || []);
        let res = { externalId: "", externalUrl: "" };
        if (ch.type === "composio") {
          const posterUrl = await publicLink(st, cr.id, cr.posterFile, "pubPoster");
          const videoUrl = posterUrl ? await publicLink(st, cr.id, cr.videoFile, "pubVideo") : "";
          res = await publishComposio(http, st, st.userId!, ch.config, { caption, title: copy.headline || m.name, link, posterUrl, videoUrl });
        }
        else if (ch.type === "webhook") {
          const pb = await getMedia(cr.posterFile);
          const r = await http(ch.config.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "looi.post", title: copy.headline, caption, link, posterBase64: pb ? await blobToB64(pb) : "" }) });
          if (!r.ok) throw new Error(`Webhook ${r.status}`);
        } else throw new Error("Unknown channel type " + ch.type);
        db.update("posts", post.id, { status: "published", externalId: res.externalId, externalUrl: res.externalUrl, publishedAt: now() });
        db.update("channels", ch.id, { status: "connected", lastError: "" });
        addEvent(m.id, "success", `Published to ${ch.name}`, `“${copy.headline}” · caption + tracked link`);
        results.push(`✓ ${ch.name}`);
      } catch (e) {
        const msg = String((e as Error).message).slice(0, 400);
        db.update("posts", post.id, { status: "failed", error: msg });
        db.update("channels", ch.id, { status: "error", lastError: msg });
        addEvent(m.id, "error", `Publish to ${ch.name} failed`, msg);
        results.push(`✗ ${ch.name}`);
      }
    }
    const ok = db.all("posts").some((p) => p.creativeId === cr.id && p.status === "published");
    db.update("creatives", cr.id, { status: ok ? "published" : "approved" });
  }
  if (results.length) notify({ title: `Publishing done · ${m.name}`, body: results.join("  "), kind: results.some((r) => r.startsWith("✗")) ? "warn" : "success", missionId: m.id });
  onStateChange();
}

export function requestPublish(m: Row, creatives: Row[], reason: string) {
  const ok = creatives.filter((c) => c.status === "draft");
  if (!ok.length) return;
  const channels = (m.channelIds || []).map((id: number) => db.get("channels", id)).filter((c: Row | undefined) => c && c.status !== "pending") as Row[];
  if (!channels.length) {
    notify({ title: `${ok.length} new ad${ok.length > 1 ? "s" : ""} ready · ${m.name}`, body: "Connect a plugin (X, LinkedIn, Reddit…) to auto-publish.", kind: "info", missionId: m.id });
    return;
  }
  const ids = channels.map((c) => c.id);
  if (m.mode === "autopilot") {
    addEvent(m.id, "decision", "Autopilot: publishing without approval", reason);
    void enqueue(m.id, "publish", () => publishCreatives(m.id, ok.map((c) => c.id), ids));
    return;
  }
  ok.forEach((c) => db.update("creatives", c.id, { status: "pending" }));
  const ap = db.insert("approvals", { missionId: m.id, kind: "publish", title: `Publish ${ok.length} ad${ok.length > 1 ? "s" : ""} to ${channels.map((c) => c.name).join(", ")}`, payload: { creativeIds: ok.map((c) => c.id), channelIds: ids, reason, summary: reason, posters: ok.map((c) => c.posterFile).filter(Boolean) }, status: "pending", createdAt: now(), decidedAt: 0 });
  notify({ title: "Approval needed", body: `${m.name}: ${ap.title}`, kind: "approval", missionId: m.id, approvalId: ap.id });
}

// ---------- queue
let queue: Promise<unknown> = Promise.resolve();
const queued = new Set<number>();
export function enqueue(missionId: number, kind: LiveJob["kind"], fn: () => Promise<unknown>) {
  if (kind !== "publish") {
    if (queued.has(missionId) || live.has(missionId)) return Promise.resolve();
    queued.add(missionId);
  }
  const run = queue.then(async () => {
    queued.delete(missionId);
    try {
      await fn();
    } catch (e) {
      console.error("job failed", e);
    }
    onStateChange();
  });
  queue = run;
  return run;
}
export const isQueued = (id: number) => queued.has(id);

// ---------- AI steps
async function aiReport(st: Settings, site: SiteData, r: any, lhM: any, lhD: any) {
  const facts = {
    url: site.finalUrl,
    status: site.status,
    https: site.https,
    responseMs: r.serverResponseMs ?? site.ttfbMs,
    htmlKb: Math.round(site.htmlBytes / 1024),
    title: site.title,
    description: site.description,
    h1: site.h1,
    h2: site.h2.slice(0, 8),
    ctas: site.ctas,
    wordCount: site.wordCount,
    images: site.images,
    imagesNoAlt: site.imagesNoAlt,
    tech: site.tech,
    securityHeaders: site.securityHeaders,
    robotsTxt: site.robotsTxt,
    sitemap: site.sitemap,
    ogImage: !!site.ogImage,
    twitterCard: site.twitterCard,
    schema: site.schemaTypes,
    brokenLinks: site.brokenLinks.length,
    render: { consoleErrors: r.consoleErrors.length, requests: r.requests, transferKb: r.transferKb, ux: r.ux, fonts: r.fonts },
    lighthouseMobile: lhM && { scores: lhM.scores, metrics: Object.fromEntries(Object.entries(lhM.metrics).map(([k, v]: any) => [k, v.display])), opportunities: lhM.opportunities.slice(0, 5).map((o: any) => `${o.title} (${o.savingsMs}ms)`), failed: lhM.failed.slice(0, 12).map((f: any) => f.title) },
    lighthouseDesktop: lhD && { scores: lhD.scores, metrics: Object.fromEntries(Object.entries(lhD.metrics).map(([k, v]: any) => [k, v.display])) },
    pageText: site.bodyText.slice(0, 2500),
  };
  const { sys, user } = reportPrompt(st, facts);
  let imageB64 = "";
  const shot = await getMedia(r.desktopShot);
  if (shot && shot.size < 900_000) imageB64 = await blobToB64(shot);
  const { data, via } = await chatJson(http, st, sys, user, { maxTokens: 4000, imageB64, temperature: 0.3 });
  return { ...data, via };
}

// ---------- launch
const LAUNCH_STEPS = ["Fetching site", "Lighthouse · mobile & desktop", "Screenshots & brand", "AI site review", "Marketing brief", "Producing ads", "Publishing"];

export async function launchMission(missionId: number) {
  let m = getMission(missionId)!;
  const st = getSettings();
  const job: LiveJob = { missionId, name: m.name || new URL(m.url).hostname, favicon: m.favicon, kind: "launch", stage: "", progress: 0, startedAt: now(), steps: LAUNCH_STEPS.map((label) => ({ label, done: false })) };
  live.set(missionId, job);
  upd(missionId, { status: "running", lastError: "" });
  try {
    setStage(job, "Fetching site", 4);
    const site = await fetchSite(m.url);
    if (!site.title && !site.bodyText && site.status >= 400) throw new Error(`Site returned HTTP ${site.status}`);
    const name = (site.og.site_name || site.title.split(/[|\-–—:·]/)[0] || new URL(site.finalUrl).hostname).trim().slice(0, 40);
    job.name = name;
    job.favicon = site.favicon;
    m = upd(missionId, { name, favicon: site.favicon });
    addEvent(m.id, "info", `HTTP ${site.status} · ${site.ttfbMs}ms response`, `${site.tech.join(", ") || "No framework fingerprint"} · ${Math.round(site.htmlBytes / 1024)}KB HTML`);

    setStage(job, "Lighthouse · mobile & desktop", 14);
    const [pm, pd] = await Promise.allSettled([runPsi(site.finalUrl, "mobile", st.psiKey), runPsi(site.finalUrl, "desktop", st.psiKey)]);
    const lhM = pm.status === "fulfilled" ? pm.value.data : null;
    const lhD = pd.status === "fulfilled" ? pd.value.data : null;
    if (pm.status === "rejected") addEvent(m.id, "warn", "Mobile Lighthouse failed", String(pm.reason?.message || pm.reason).slice(0, 300));
    if (pd.status === "rejected") addEvent(m.id, "warn", "Desktop Lighthouse failed", String(pd.reason?.message || pd.reason).slice(0, 300));

    setStage(job, "Screenshots & brand", 38);
    const key = `m${m.id}-${Math.random().toString(36).slice(2, 8)}`;
    const render = await captureFromPsi(key, site, pm.status === "fulfilled" ? pm.value.lhr : null, pd.status === "fulfilled" ? pd.value.lhr : null);
    const brand = deriveBrand(render.palette, site.themeColor);
    if (render.serverResponseMs != null) site.ttfbMs = render.serverResponseMs;
    const { _fonts, _ctaAboveFold, _navItems, ...siteClean } = site as any;
    m = upd(missionId, { site: { ...siteClean, bodyText: site.bodyText.slice(0, 3000), render, brand } });
    const health = computeHealth(site, lhM ?? undefined, lhD ?? undefined);
    const report: any = { measuredAt: now(), lighthouse: { mobile: lhM, desktop: lhD }, health };
    m = upd(missionId, { report, healthScore: health });
    if (lhM) addEvent(m.id, "info", `Lighthouse mobile: Perf ${lhM.scores.performance} · A11y ${lhM.scores.accessibility} · SEO ${lhM.scores.seo}`, `LCP ${lhM.metrics.lcp.display} · CLS ${lhM.metrics.cls.display} · TBT ${lhM.metrics.tbt.display}`);

    setStage(job, "AI site review", 50);
    try {
      report.ai = await aiReport(st, site, render, lhM, lhD);
      m = upd(missionId, { report: { ...report } });
      addEvent(m.id, "info", `AI review: ${report.ai.verdict} · UI/UX ${report.ai.uiux?.score}/100`, `${report.ai.summary} (via ${report.ai.via})`);
    } catch (e) {
      addEvent(m.id, "warn", "AI review unavailable", String((e as Error).message).slice(0, 300));
    }

    setStage(job, "Marketing brief", 60);
    const bp = briefPrompt(st, m.goal, site);
    const { data: briefData, via } = await chatJson(http, st, bp.sys, bp.user, { maxTokens: 6000, temperature: 0.8 });
    const brief = { ...briefData, via };
    m = upd(missionId, { brief, name: brief.product?.name || name });
    job.name = m.name;
    addEvent(m.id, "info", `Brief: ${brief.product?.oneLiner || ""}`, `Audience: ${brief.product?.audience || ""} · ${brief.angles?.length || 0} angles (via ${via})`);
    for (const pb of (brief.playbooks || []).slice(0, 4)) db.insert("playbooks", { missionId: m.id, cycle: 0, channel: pb.channel, title: pb.title, content: pb.content, status: "ready", createdAt: now() });

    setStage(job, "Producing ads", 68);
    const angles: any[] = brief.angles || [];
    const plan: [number, TemplateKey, FormatKey][] = [
      [0, "kinetic", "square"],
      [1, "tour", "story"],
      [2, "problem", "landscape"],
      [3, "spotlight", "square"],
    ];
    const made: Row[] = [];
    for (let i = 0; i < plan.length; i++) {
      const [ai, tpl, fmt] = plan[i];
      const a = angles[ai] || angles[0];
      if (!a) continue;
      job.stage = `Producing ads · ${i + 1}/${plan.length}`;
      job.progress = 68 + Math.round((i / plan.length) * 26);
      upd(missionId, { stage: job.stage, progress: job.progress });
      const cr = createCreative(getMission(missionId)!, 0, a, tpl, fmt);
      made.push(await renderCreative(cr, job));
    }
    addEvent(m.id, "success", `${made.filter((c) => c.status === "draft").length} production ads rendered on this phone`, "MP4 + poster for 1:1, 9:16 and 16:9");

    setStage(job, "Publishing", 96);
    const interval = st.intervalMinutes || 150;
    m = upd(missionId, { status: "active", stage: "Monitoring", progress: 100, cycle: 0, lastCheckAt: now(), nextCheckAt: now() + interval * 60000 });
    db.insert("snapshots", { missionId: m.id, cycle: 0, ts: now(), data: { health, perf: lhM?.scores.performance, seo: lhM?.scores.seo, a11y: lhM?.scores.accessibility, ttfb: site.ttfbMs, clicks: 0 } });
    requestPublish(m, made, "Initial launch batch");
    notify({ title: `Mission live · ${m.name}`, body: `Health ${health}/100. ${made.length} ads ready. Next check in ${Math.round((interval / 60) * 10) / 10}h.`, kind: "success", missionId: m.id });
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 500);
    upd(missionId, { status: "failed", lastError: msg, stage: "Failed" });
    addEvent(m.id, "error", "Mission failed", msg);
    notify({ title: `Mission failed · ${m.name || m.url}`, body: msg, kind: "error", missionId: m.id });
  } finally {
    live.delete(missionId);
  }
}

// ---------- check cycle (foreground; the background runner runs a lighter version)
const CHECK_STEPS = ["Re-checking site", "Collecting metrics", "Strategist thinking", "Producing new ad", "Reporting"];

export async function checkMission(missionId: number, manual = false) {
  let m = getMission(missionId);
  if (!m) return;
  const st = getSettings();
  const job: LiveJob = { missionId, name: m.name, favicon: m.favicon, kind: "check", stage: "", progress: 0, startedAt: now(), steps: CHECK_STEPS.map((label) => ({ label, done: false })) };
  live.set(missionId, job);
  const cycle = (m.cycle || 0) + 1;
  const wasPaused = m.status === "paused";
  upd(missionId, { status: "running" });
  try {
    addEvent(m.id, "info", `Cycle ${cycle} started${manual ? " (manual)" : ""}`);
    setStage(job, "Re-checking site", 10);
    const r = await http(m.url, { headers: { "User-Agent": "Mozilla/5.0 LooiAgent/1.0" }, timeout: 25000 });
    let perf: number | undefined;
    let lcp = "";
    try {
      const lh = await runPsi(m.url, "mobile", st.psiKey, ["performance", "seo"]);
      perf = lh.data.scores.performance;
      lcp = lh.data.metrics.lcp.display;
    } catch {}
    const up = r.status < 400;
    if (!up) notify({ title: `Site issue · ${m.name}`, body: `Your site returned HTTP ${r.status}. New ads paused until it's back.`, kind: "error", missionId: m.id });

    setStage(job, "Collecting metrics", 30);
    const posts = db.where("posts", (p) => p.missionId === m!.id && p.status === "published");
    const creatives = db.where("creatives", (c) => c.missionId === m!.id);
    const perCreative = creatives.map((c) => ({ id: c.id, cycle: c.cycle, angle: c.angle, template: c.template, format: c.format, headline: c.copy?.headline, status: c.status, posts: posts.filter((p) => p.creativeId === c.id).length }));
    const recent = db.where("snapshots", (s) => s.missionId === m!.id).slice(-3).map((s) => s.data);
    addEvent(m.id, "info", `Metrics: ${posts.length} live posts · ${creatives.length} ads`, "Links carry UTM tags — see clicks in your analytics (on-device mode has no redirect tracker).");

    setStage(job, "Strategist thinking", 50);
    const connected = db.where("channels", (c) => c.status === "connected").map((c) => (c.type === "composio" ? c.config.toolkit : c.type));
    const usedPlaybooks = db.where("playbooks", (p) => p.missionId === m!.id).map((p) => p.channel);
    const sp = strategistPrompt(st, { product: m.brief?.product, cycle, status: r.status, ttfbMs: r.ms, perf, lcp, recent, perCreative, connected, usedPlaybooks, topIssues: (m.report?.ai?.issues || []).slice(0, 5).map((i: any) => i.title) });
    const { data: plan, via } = await chatJson<any>(http, st, sp.sys, sp.user, { maxTokens: 5000, temperature: 0.8 });
    m = upd(missionId, { strategy: { ...plan, via, cycle, at: now() } });
    addEvent(m.id, "decision", `Strategist: ${String(plan.decision || "iterate").toUpperCase()} — ${plan.nextAngle?.name || "new angle"}`, `${plan.assessment || ""}\n${plan.reasoning || ""}`);
    for (const pb of (plan.playbooks || []).slice(0, 2)) db.insert("playbooks", { missionId: m.id, cycle, channel: pb.channel, title: pb.title, content: pb.content, status: "ready", createdAt: now() });

    setStage(job, "Producing new ad", 65);
    const made: Row[] = [];
    if (up && plan.nextAngle) {
      const tpl: TemplateKey = (TEMPLATES as readonly string[]).includes(plan.template) ? plan.template : "kinetic";
      const fmt: FormatKey = ["square", "story", "landscape"].includes(plan.format) ? plan.format : "square";
      made.push(await renderCreative(createCreative(m, cycle, plan.nextAngle, tpl, fmt), job));
    }

    setStage(job, "Reporting", 92);
    const ls = m.report?.lighthouse?.mobile?.scores;
    const health = computeHealth({ ...(m.site || {}), ttfbMs: r.ms }, perf !== undefined ? { scores: { performance: perf, accessibility: ls?.accessibility ?? 70, bestPractices: ls?.bestPractices ?? 70, seo: ls?.seo ?? 70 } } : undefined);
    db.insert("snapshots", { missionId: m.id, cycle, ts: now(), data: { health, perf, ttfb: r.ms, clicks: 0, decision: plan.decision } });
    const interval = st.intervalMinutes || 150;
    m = upd(missionId, { status: wasPaused ? "paused" : "active", cycle, stage: "Monitoring", progress: 100, lastCheckAt: now(), nextCheckAt: now() + interval * 60000, healthScore: health });
    if (made.length) requestPublish(m, made, plan.reasoning || "");
    notify({ title: `Cycle ${cycle} update · ${m.name}`, body: plan.userUpdate || plan.assessment || "Check complete.", kind: "update", missionId: m.id });
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 400);
    addEvent(m!.id, "error", `Cycle ${cycle} failed`, msg);
    const interval = st.intervalMinutes || 150;
    upd(missionId, { status: wasPaused ? "paused" : "active", stage: "Monitoring", progress: 100, lastError: msg, nextCheckAt: now() + Math.min(interval, 30) * 60000 });
    notify({ title: `Check failed · ${m!.name}`, body: msg + " — retrying soon.", kind: "error", missionId: m!.id });
  } finally {
    live.delete(missionId);
  }
}

export async function generateMore(missionId: number) {
  const m = getMission(missionId)!;
  const job: LiveJob = { missionId, name: m.name, favicon: m.favicon, kind: "generate", stage: "Producing ads", progress: 30, startedAt: now(), steps: [{ label: "Producing ads", done: false }] };
  live.set(missionId, job);
  try {
    const angles = m.brief?.angles || [];
    const n = db.where("creatives", (c) => c.missionId === m.id).length;
    const a = angles[n % Math.max(angles.length, 1)];
    if (a) {
      const c = await renderCreative(createCreative(m, m.cycle, a, TEMPLATES[n % TEMPLATES.length], (["square", "story", "landscape"] as FormatKey[])[n % 3]), job);
      requestPublish(getMission(missionId)!, [c], "Manual generation");
    }
  } finally {
    live.delete(missionId);
  }
}

/** Render creatives the background runner queued while the app was closed. */
export function renderPending() {
  const pend = db.where("creatives", (c) => c.status === "needs-render");
  const byMission = new Map<number, Row[]>();
  pend.forEach((c) => byMission.set(c.missionId, [...(byMission.get(c.missionId) || []), c]));
  for (const [mid, list] of byMission) {
    enqueue(mid, "generate", async () => {
      const m = getMission(mid);
      if (!m) return;
      const job: LiveJob = { missionId: mid, name: m.name, favicon: m.favicon, kind: "generate", stage: "Producing ads", progress: 40, startedAt: now(), steps: [{ label: "Producing ads", done: false }] };
      live.set(mid, job);
      try {
        const made: Row[] = [];
        for (const c of list) {
          const r = await renderCreative(c, job);
          if (c.copy?._published && r.status === "draft") db.update("creatives", r.id, { status: "published" });
          else made.push(r);
        }
        requestPublish(getMission(mid)!, made, list[0]?.copy?._reason || "Created by the background agent");
      } finally {
        live.delete(mid);
      }
    });
  }
}

// ---------- foreground scheduler
let started = false;
export function startScheduler() {
  if (started) return;
  started = true;
  for (const m of db.where("missions", (x) => x.status === "running")) upd(m.id, !m.brief || !m.brief.product ? { status: "queued" } : { status: "active", nextCheckAt: now() + 60000 });
  for (const m of db.where("missions", (x) => x.status === "queued")) enqueue(m.id, "launch", () => launchMission(m.id));
  renderPending();
  const tick = () => {
    for (const m of db.where("missions", (x) => x.status === "active" && x.nextCheckAt <= now())) enqueue(m.id, "check", () => checkMission(m.id));
  };
  setInterval(tick, 30000);
  setTimeout(tick, 5000);
}
