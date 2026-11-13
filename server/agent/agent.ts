import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { storage } from "../storage";
import type { Mission, Settings, Creative } from "@shared/schema";
import { fetchSite, renderSite, runLighthouse, readMediaB64, mediaPath, type SiteData, type RenderData, type LighthouseData } from "./analyze";
import { buildAdHtml, renderAd, deriveBrand, type AdCopy, type Brand, type FormatKey, type TemplateKey, TEMPLATES } from "./render";
import { chatJson, imageGenAvailable } from "./llm";
import * as billing from "../billing";
import { publishTo, captionFor, fetchMetrics } from "./publish";
import { publishComposio } from "./composio";
import { exclusive } from "./browser";

// ---------- live state (for the running pill)
export interface LiveJob {
  missionId: number;
  ownerId: string;
  name: string;
  favicon: string;
  kind: "launch" | "check" | "generate" | "publish";
  stage: string;
  progress: number;
  startedAt: number;
  steps: { label: string; done: boolean }[];
}
export const live = new Map<number, LiveJob>();

const J = (s: string, d: any = {}) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

function setStage(job: LiveJob, stage: string, progress: number) {
  job.steps.forEach((s) => s.label !== stage && (s.done = s.done || false));
  const idx = job.steps.findIndex((s) => s.label === stage);
  if (idx >= 0) job.steps.forEach((s, i) => (s.done = i < idx));
  job.stage = stage;
  job.progress = progress;
  storage.updateMission(job.missionId, { stage, progress });
  storage.addEvent(job.ownerId, job.missionId, "step", stage);
}

export function publicBase(st: Settings) {
  return (st.publicBaseUrl || process.env.LOOI_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
}

function trackedLink(st: Settings, m: Mission, code: string, source: string) {
  const base = publicBase(st);
  if (base) return `${base}/r/${code}`;
  const u = new URL(m.url);
  u.searchParams.set("utm_source", source);
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", `looi-${m.id}`);
  u.searchParams.set("utm_content", code);
  return u.toString();
}

// ---------- health score
export function computeHealth(site: SiteData, lhM?: LighthouseData, lhD?: LighthouseData) {
  const sec = Object.values(site.securityHeaders).filter(Boolean).length / 6;
  const perf = lhM ? (lhM.scores.performance * 0.6 + (lhD?.scores.performance ?? lhM.scores.performance) * 0.4) : Math.max(0, 100 - site.ttfbMs / 20);
  const a11y = lhM?.scores.accessibility ?? 70;
  const bp = lhM?.scores.bestPractices ?? 70;
  const seo = lhM?.scores.seo ?? 70;
  const security = (site.https ? 50 : 0) + sec * 50;
  return Math.round(perf * 0.3 + a11y * 0.2 + bp * 0.15 + seo * 0.2 + security * 0.15);
}

// ---------- AI steps
async function aiReport(st: Settings, site: SiteData, r: RenderData, lhM: LighthouseData | null, lhD: LighthouseData | null) {
  const facts = {
    url: site.finalUrl,
    status: site.status,
    https: site.https,
    ttfbMs: site.ttfbMs,
    htmlKb: Math.round(site.htmlBytes / 1024),
    compression: site.compression,
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
    render: { consoleErrors: r.consoleErrors.length, failedRequests: r.failedRequests, requests: r.requests, ux: r.ux, fonts: r.fonts },
    lighthouseMobile: lhM && { scores: lhM.scores, metrics: Object.fromEntries(Object.entries(lhM.metrics).map(([k, v]) => [k, v.display])), opportunities: lhM.opportunities.slice(0, 5).map((o) => `${o.title} (${o.savingsMs}ms)`), failed: lhM.failed.slice(0, 12).map((f) => f.title) },
    lighthouseDesktop: lhD && { scores: lhD.scores, metrics: Object.fromEntries(Object.entries(lhD.metrics).map(([k, v]) => [k, v.display])) },
    pageText: (r.renderedText || site.bodyText).slice(0, 2500),
  };
  const sys = `You are Looi, a senior web performance + UI/UX + CRO auditor. You receive REAL measured data (Lighthouse, HTTP, DOM checks) and a desktop screenshot. Never invent metrics; reference the given numbers. Be specific and actionable. Language: ${st.language}.`;
  const user = `Audit this site and return JSON:
{"summary": string (3 sentences),
 "verdict": "Excellent"|"Good"|"Needs work"|"Poor",
 "uiux": {"score": 0-100, "verdict": string, "strengths": string[3-5], "problems": string[3-6]},
 "issues": [{"severity":"critical"|"high"|"medium"|"low","area":"Performance"|"SEO"|"Accessibility"|"Security"|"UX"|"Content"|"Conversion","title": string,"detail": string,"fix": string}] (6-12 items, ordered by impact),
 "quickWins": string[4-6],
 "marketingReadiness": {"score": 0-100, "notes": string}}
DATA:
${JSON.stringify(facts)}`;
  const { data, via } = await chatJson(st, sys, user, { maxTokens: 4000, imageB64: readMediaB64(r.desktopShot), temperature: 0.3 });
  return { ...data, via };
}

const ANGLE_SCHEMA = `{"name": string (angle name e.g. "Speed", "Pain killer", "Social proof"), "hook": string (<=5 words, uppercase-able kicker), "headline": string (<=7 words, punchy), "sub": string (<=16 words), "pain": string (<=6 words, a question), "benefits": [string,string,string] (<=5 words each), "cta": string (<=3 words), "captions": {"x": string (<=200 chars, include {link}), "linkedin": string (3-5 short lines, include {link}), "instagram": string (with emojis, include {link}), "telegram": string (include {link}), "generic": string (include {link})}, "hashtags": string[5]}`;

async function aiBrief(st: Settings, m: Mission, site: SiteData, r: RenderData) {
  const sys = `You are Looi, a world-class growth marketer and ad copywriter. Write copy that is specific to the product (use real features from the page), never generic. Language for copy: ${st.language}. ${st.brandVoice ? "Brand voice: " + st.brandVoice : ""}`;
  const user = `Product URL: ${site.finalUrl}
Title: ${site.title}
Description: ${site.description}
Headline on site: ${r.ux.heroHeadline}
H2s: ${site.h2.slice(0, 10).join(" | ")}
CTAs: ${site.ctas.join(", ")}
User goal: ${m.goal || "Get as many users/customers as possible"}
Page text: ${(r.renderedText || site.bodyText).slice(0, 3500)}

Return JSON:
{"product": {"name": string, "oneLiner": string, "category": string, "audience": string, "pains": string[3], "usps": string[4], "tone": string},
 "angles": [${ANGLE_SCHEMA}, ... 4 distinct angles],
 "channelPlan": [{"channel": string, "why": string, "priority": 1-3}] (5-7 channels incl. organic communities),
 "playbooks": [{"channel": "product_hunt"|"reddit"|"hacker_news"|"indie_hackers"|"seo_blog"|"cold_email"|"influencer_dm"|"whatsapp", "title": string, "content": string (ready-to-paste, complete)}] (3 items)}`;
  const { data, via } = await chatJson(st, sys, user, { maxTokens: 6000, temperature: 0.8 });
  return { ...data, via };
}

async function aiVisual(st: Settings, key: string, brief: any, primary: string): Promise<string> {
  if (!st.aiVisuals || !imageGenAvailable()) return "";
  const out = `${key}-visual.png`;
  const prompt = `Premium cinematic advertising key visual for "${brief.product?.name}" — ${brief.product?.oneLiner}. Category: ${brief.product?.category}. Abstract, high-end 3D render, soft volumetric light, glossy materials, dominant brand color ${primary}, dark moody background, lots of negative space on the left for headline text. No text, no letters, no logos, no UI screenshots.`;
  await new Promise<void>((res, rej) => {
    const p = spawn("python3", [path.resolve("server/py/gen_image_cli.py"), JSON.stringify({ prompt, aspect: "1:1", out: mediaPath(out) })], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-500)));
    const t = setTimeout(() => p.kill("SIGKILL"), 180000);
    p.on("close", (c) => (clearTimeout(t), c === 0 ? res() : rej(new Error("image gen failed: " + err))));
  });
  return fs.existsSync(mediaPath(out)) ? out : "";
}

function brandFor(m: Mission): Brand {
  const site = J(m.site);
  const b = site.brand || {};
  return {
    name: J(m.brief).product?.name || m.name,
    domain: new URL(m.url).hostname.replace(/^www\./, ""),
    primary: b.primary,
    dark: b.dark,
    light: b.light,
    logoFile: site.render?.logoFile || "",
    logoTone: site.render?.logoTone,
    desktopShot: site.render?.desktopShot,
    mobileShot: site.render?.mobileShot,
    fullShot: site.render?.fullShot,
    aiVisual: site.aiVisual || "",
  };
}

async function produceCreative(m: Mission, cycle: number, angle: AdCopy & { name?: string }, template: TemplateKey, format: FormatKey): Promise<Creative | null> {
  if (!billing.canCreate(m.ownerId)) {
    storage.addEvent(m.ownerId, m.id, "warn", "Ad skipped: plan limit reached", "Your plan's ad allowance for this period is used up. The agent keeps monitoring and writing playbooks.");
    if (billing.shouldNoticeLimit(m.ownerId)) storage.notify(m.ownerId, { title: "Ad limit reached", body: "Looi paused new video ads for this period. Upgrade in Billing to keep the agent producing.", kind: "warn", missionId: m.id });
    return null;
  }
  const cr = storage.createCreative({ ownerId: m.ownerId, missionId: m.id, cycle, angle: angle.name || "", template, format, copy: JSON.stringify(angle), posterFile: "", videoFile: "", status: "rendering" });
  try {
    const html = buildAdHtml(template, format, brandFor(m), {
      ...angle,
      benefits: (angle.benefits || []).slice(0, 3),
      captions: angle.captions || {},
      hashtags: angle.hashtags || [],
    });
    const base = `m${m.id}-c${cr.id}-${crypto.randomBytes(4).toString("hex")}`;
    const { video, poster } = await exclusive(() => renderAd(html, format, base));
    return storage.updateCreative(cr.id, { videoFile: video, posterFile: poster, status: "draft" });
  } catch (e) {
    storage.addEvent(m.ownerId, m.id, "error", "Ad render failed", String((e as Error).message));
    return storage.updateCreative(cr.id, { status: "failed" });
  }
}

// ---------- publishing
export async function publishCreatives(missionId: number, creativeIds: number[], channelIds: number[]) {
  const m = storage.getMission(missionId);
  if (!m) return;
  const st = storage.getSettings(m.ownerId);
  const results: string[] = [];
  for (const cid of creativeIds) {
    const cr = storage.getCreative(cid);
    if (!cr || !cr.videoFile) continue;
    const copy = J(cr.copy);
    for (const chId of channelIds) {
      const ch = storage.getChannel(chId);
      if (!ch || ch.ownerId !== m.ownerId || ch.status === "pending") continue;
      const code = crypto.randomBytes(5).toString("base64url");
      const link = trackedLink(st, m, code, ch.type === "composio" ? J(ch.config).toolkit || "composio" : ch.type);
      const post = storage.createPost({ ownerId: m.ownerId, missionId: m.id, creativeId: cr.id, channelId: ch.id, channelType: ch.type === "composio" ? J(ch.config).toolkit || "composio" : ch.type, linkCode: code, externalId: "", externalUrl: "", status: "queued", error: "", metrics: "{}", publishedAt: 0 });
      try {
        const base = publicBase(st);
        const tk = ch.type === "composio" ? J(ch.config).toolkit || "generic" : ch.type;
        const capKey = tk === "twitter" ? "x" : tk === "discordbot" ? "discord" : tk;
        const caption = captionFor(capKey, copy.captions || {}, link, copy.hashtags || []);
        const res =
          ch.type === "composio"
            ? await publishComposio(st, ch, { caption, title: copy.headline || m.name, link, posterUrl: base && cr.posterFile ? `${base}/api/public/media/${cr.posterFile}` : "", videoUrl: base && cr.videoFile ? `${base}/api/public/media/${cr.videoFile}` : "" })
            : await publishTo(ch, { caption, link, videoFile: cr.videoFile, posterFile: cr.posterFile, publicBase: base, title: copy.headline || m.name });
        storage.updatePost(post.id, { status: "published", externalId: res.externalId, externalUrl: res.externalUrl, publishedAt: Date.now() });
        storage.updateChannel(ch.id, { status: "connected", lastError: "" });
        storage.addEvent(m.ownerId, m.id, "success", `Published to ${ch.name}`, `“${copy.headline}” · ${cr.format}`);
        results.push(`✓ ${ch.name}`);
      } catch (e) {
        const msg = String((e as Error).message).slice(0, 400);
        storage.updatePost(post.id, { status: "failed", error: msg });
        storage.updateChannel(ch.id, { status: "error", lastError: msg });
        storage.addEvent(m.ownerId, m.id, "error", `Publish to ${ch.name} failed`, msg);
        results.push(`✗ ${ch.name}`);
      }
    }
    storage.updateCreative(cr.id, { status: storage.listPosts(m.id).some((p) => p.creativeId === cr.id && p.status === "published") ? "published" : "approved" });
  }
  if (results.length) storage.notify(m.ownerId, { title: `Publishing done · ${m.name}`, body: results.join("  "), kind: results.some((r) => r.startsWith("✗")) ? "warn" : "success", missionId: m.id });
}

function requestPublish(m: Mission, creatives: Creative[], reason: string) {
  const ok = creatives.filter((c) => c.status === "draft");
  if (!ok.length) return;
  const channelIds: number[] = J(m.channelIds, []);
  const channels = channelIds.map((id) => storage.getChannel(id)).filter((c) => c && c.status !== "pending");
  const readyIds = channels.map((c) => c!.id);
  if (!channels.length) {
    storage.notify(m.ownerId, { title: `${ok.length} new ad${ok.length > 1 ? "s" : ""} ready · ${m.name}`, body: "Connect a channel and attach it to this mission to auto-publish.", kind: "info", missionId: m.id });
    return;
  }
  if (m.mode === "autopilot" && billing.autopilotAllowed(m.ownerId)) {
    storage.addEvent(m.ownerId, m.id, "decision", "Autopilot: publishing without approval", reason);
    void enqueue(m.id, "publish", () => publishCreatives(m.id, ok.map((c) => c.id), readyIds));
    return;
  }
  ok.forEach((c) => storage.updateCreative(c.id, { status: "pending" }));
  const ap = storage.createApproval({ ownerId: m.ownerId, missionId: m.id, kind: "publish", title: `Publish ${ok.length} ad${ok.length > 1 ? "s" : ""} to ${channels.map((c) => c!.name).join(", ")}`, payload: JSON.stringify({ creativeIds: ok.map((c) => c.id), channelIds: readyIds, reason, summary: reason, posters: ok.map((c) => c.posterFile).filter(Boolean) }) });
  storage.notify(m.ownerId, { title: "Approval needed", body: `${m.name}: ${ap.title}`, kind: "approval", missionId: m.id, approvalId: ap.id });
}

// ---------- job queue: small worker pool, paid plans first. Heavy Chromium/ffmpeg work is still serialised by exclusive().
const WORKERS = Math.max(1, parseInt(process.env.LOOI_WORKERS || "2", 10) || 2);
type Job = { missionId: number; kind: LiveJob["kind"]; fn: () => Promise<unknown>; prio: number; seq: number; done: () => void };
const pending: Job[] = [];
const queued = new Set<number>();
let running = 0;
let seq = 0;
function pump() {
  while (running < WORKERS && pending.length) {
    pending.sort((a, b) => b.prio - a.prio || a.seq - b.seq);
    const j = pending.shift()!;
    queued.delete(j.missionId);
    running++;
    j.fn()
      .catch((e) => console.error("job failed", e))
      .finally(() => {
        running--;
        j.done();
        pump();
      });
  }
}
export function enqueue(missionId: number, kind: LiveJob["kind"], fn: () => Promise<unknown>) {
  if (kind !== "publish") {
    if (queued.has(missionId) || live.has(missionId)) return Promise.resolve();
    queued.add(missionId);
  }
  const owner = storage.getMission(missionId)?.ownerId || "";
  return new Promise<void>((done) => {
    pending.push({ missionId, kind, fn, prio: (kind === "publish" ? 10 : 0) + (owner ? billing.priorityFor(owner) : 0), seq: seq++, done });
    pump();
  });
}

// ---------- launch pipeline
const LAUNCH_STEPS = ["Fetching site", "Rendering & capturing", "Lighthouse · mobile", "Lighthouse · desktop", "AI site review", "Marketing brief", "AI key visual", "Producing ads", "Publishing"];

export async function launchMission(missionId: number) {
  let m = storage.getMission(missionId)!;
  const st = storage.getSettings(m.ownerId);
  const job: LiveJob = { missionId, ownerId: m.ownerId, name: m.name || new URL(m.url).hostname, favicon: m.favicon, kind: "launch", stage: "", progress: 0, startedAt: Date.now(), steps: LAUNCH_STEPS.map((label) => ({ label, done: false })) };
  live.set(missionId, job);
  storage.updateMission(missionId, { status: "running", lastError: "" });
  try {
    setStage(job, "Fetching site", 4);
    const site = await fetchSite(m.url);
    const name = (site.og.site_name || site.title.split(/[|\-–—:·]/)[0] || new URL(site.finalUrl).hostname).trim().slice(0, 40);
    job.name = name;
    job.favicon = site.favicon;
    m = storage.updateMission(missionId, { name, favicon: site.favicon });
    storage.addEvent(m.ownerId, m.id, "info", `HTTP ${site.status} · TTFB ${site.ttfbMs}ms`, `${site.tech.join(", ") || "No framework fingerprint"} · ${Math.round(site.htmlBytes / 1024)}KB HTML`);

    setStage(job, "Rendering & capturing", 14);
    const key = `m${m.id}-${crypto.randomBytes(4).toString("hex")}`;
    const render = await exclusive(() => renderSite(site.finalUrl, key));
    const brand = deriveBrand(render.palette, site.themeColor);
    storage.updateMission(missionId, { site: JSON.stringify({ ...site, bodyText: site.bodyText.slice(0, 3000), render: { ...render, renderedText: render.renderedText.slice(0, 3000) }, brand }) });

    setStage(job, "Lighthouse · mobile", 26);
    let lhM: LighthouseData | null = null,
      lhD: LighthouseData | null = null;
    try {
      lhM = await exclusive(() => runLighthouse(site.finalUrl, "mobile", st.psiKey));
    } catch (e) {
      storage.addEvent(m.ownerId, m.id, "warn", "Mobile Lighthouse failed", String((e as Error).message).slice(0, 300));
    }
    setStage(job, "Lighthouse · desktop", 40);
    try {
      lhD = await exclusive(() => runLighthouse(site.finalUrl, "desktop", st.psiKey));
    } catch (e) {
      storage.addEvent(m.ownerId, m.id, "warn", "Desktop Lighthouse failed", String((e as Error).message).slice(0, 300));
    }
    const health = computeHealth(site, lhM ?? undefined, lhD ?? undefined);
    const report: any = { measuredAt: Date.now(), lighthouse: { mobile: lhM, desktop: lhD }, health };
    storage.updateMission(missionId, { report: JSON.stringify(report), healthScore: health });
    if (lhM) storage.addEvent(m.ownerId, m.id, "info", `Lighthouse mobile: Perf ${lhM.scores.performance} · A11y ${lhM.scores.accessibility} · SEO ${lhM.scores.seo}`, `LCP ${lhM.metrics.lcp.display} · CLS ${lhM.metrics.cls.display} · TBT ${lhM.metrics.tbt.display}`);

    setStage(job, "AI site review", 52);
    try {
      report.ai = await aiReport(st, site, render, lhM, lhD);
      storage.updateMission(missionId, { report: JSON.stringify(report) });
      storage.addEvent(m.ownerId, m.id, "info", `AI review: ${report.ai.verdict} · UI/UX ${report.ai.uiux?.score}/100`, `${report.ai.summary} (via ${report.ai.via})`);
    } catch (e) {
      storage.addEvent(m.ownerId, m.id, "warn", "AI review unavailable", String((e as Error).message).slice(0, 300));
    }

    setStage(job, "Marketing brief", 60);
    const brief = await aiBrief(st, m, site, render);
    m = storage.updateMission(missionId, { brief: JSON.stringify(brief), name: brief.product?.name || name });
    job.name = m.name;
    storage.addEvent(m.ownerId, m.id, "info", `Brief: ${brief.product?.oneLiner || ""}`, `Audience: ${brief.product?.audience || ""} · ${brief.angles?.length || 0} angles (via ${brief.via})`);
    for (const pb of (brief.playbooks || []).slice(0, 4)) storage.addPlaybook({ ownerId: m.ownerId, missionId: m.id, cycle: 0, channel: pb.channel, title: pb.title, content: pb.content });

    setStage(job, "AI key visual", 66);
    try {
      const vis = await aiVisual(st, key, brief, brand.primary);
      if (vis) {
        const s = J(storage.getMission(missionId)!.site);
        s.aiVisual = vis;
        m = storage.updateMission(missionId, { site: JSON.stringify(s) });
      }
    } catch (e) {
      storage.addEvent(m.ownerId, m.id, "warn", "AI visual skipped", String((e as Error).message).slice(0, 200));
    }

    setStage(job, "Producing ads", 70);
    const angles: any[] = brief.angles || [];
    const plan: [number, TemplateKey, FormatKey][] = [
      [0, "kinetic", "square"],
      [1, "tour", "story"],
      [2, "problem", "landscape"],
      [3, "spotlight", "square"],
    ];
    const made: Creative[] = [];
    for (let i = 0; i < plan.length; i++) {
      const [ai, tpl, fmt] = plan[i];
      const a = angles[ai] || angles[0];
      if (!a) continue;
      job.stage = `Producing ads · ${i + 1}/${plan.length}`;
      job.progress = 70 + Math.round((i / plan.length) * 22);
      storage.updateMission(missionId, { stage: job.stage, progress: job.progress });
      const c = await produceCreative(storage.getMission(missionId)!, 0, a, tpl, fmt);
      if (c) made.push(c);
    }
    storage.addEvent(m.ownerId, m.id, "success", `${made.filter((c) => c.status === "draft").length} production ads rendered`, "MP4 + poster for 1:1, 9:16 and 16:9");

    setStage(job, "Publishing", 95);
    const interval = billing.intervalFor(m.ownerId, st.intervalMinutes || 150);
    m = storage.updateMission(missionId, { status: "active", stage: "Monitoring", progress: 100, cycle: 0, lastCheckAt: Date.now(), nextCheckAt: Date.now() + interval * 60000 });
    storage.addSnapshot(m.id, 0, { health, perf: lhM?.scores.performance, seo: lhM?.scores.seo, a11y: lhM?.scores.accessibility, ttfb: site.ttfbMs, clicks: 0 });
    requestPublish(m, made, "Initial launch batch");
    storage.notify(m.ownerId, { title: `Mission live · ${m.name}`, body: `Health ${health}/100. ${made.length} ads ready. Next check in ${Math.round(interval / 60 * 10) / 10}h.`, kind: "success", missionId: m.id });
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 500);
    storage.updateMission(missionId, { status: "failed", lastError: msg, stage: "Failed" });
    storage.addEvent(m.ownerId, m.id, "error", "Mission failed", msg);
    storage.notify(m.ownerId, { title: `Mission failed · ${m.name || m.url}`, body: msg, kind: "error", missionId: m.id });
  } finally {
    live.delete(missionId);
  }
}

// ---------- monitoring / strategist cycle
const CHECK_STEPS = ["Re-checking site", "Collecting metrics", "Strategist thinking", "Producing new ad", "Reporting"];

export async function checkMission(missionId: number, manual = false) {
  let m = storage.getMission(missionId)!;
  if (!m) return;
  const st = storage.getSettings(m.ownerId);
  const job: LiveJob = { missionId, ownerId: m.ownerId, name: m.name, favicon: m.favicon, kind: "check", stage: "", progress: 0, startedAt: Date.now(), steps: CHECK_STEPS.map((label) => ({ label, done: false })) };
  live.set(missionId, job);
  const cycle = m.cycle + 1;
  storage.updateMission(missionId, { status: "running" });
  try {
    storage.addEvent(m.ownerId, m.id, "info", `Cycle ${cycle} started${manual ? " (manual)" : ""}`);
    setStage(job, "Re-checking site", 10);
    const site = await fetchSite(m.url);
    let perf: number | undefined;
    let lcp = "";
    try {
      const lh = await exclusive(() => runLighthouse(site.finalUrl, "mobile", st.psiKey, ["performance", "seo"]));
      perf = lh.scores.performance;
      lcp = lh.metrics.lcp.display;
    } catch {}
    const up = site.status < 400;
    if (!up) storage.notify(m.ownerId, { title: `Site issue · ${m.name}`, body: `Your site returned HTTP ${site.status}. Ads paused until it's back.`, kind: "error", missionId: m.id });

    setStage(job, "Collecting metrics", 30);
    const posts = storage.listPosts(m.id).filter((p) => p.status === "published");
    const allClicks = storage.clicksFor(m.id);
    const sinceClicks = storage.clicksFor(m.id, m.lastCheckAt);
    // platform metrics
    const byChannel = new Map<number, string[]>();
    posts.forEach((p) => p.externalId && byChannel.set(p.channelId, [...(byChannel.get(p.channelId) || []), p.externalId]));
    for (const [chId, ids] of byChannel) {
      const ch = storage.getChannel(chId);
      if (!ch) continue;
      const met = await fetchMetrics(ch, ids);
      posts.filter((p) => p.channelId === chId && met[p.externalId]).forEach((p) => storage.updatePost(p.id, { metrics: JSON.stringify(met[p.externalId]) }));
    }
    const creatives = storage.listCreatives(m.id);
    const perCreative = creatives.map((c) => {
      const ps = posts.filter((p) => p.creativeId === c.id);
      const clicks = allClicks.filter((k) => ps.some((p) => p.linkCode === k.linkCode)).length;
      const platform = ps.map((p) => ({ channel: p.channelType, ...J(storage.listPosts(m.id).find((x) => x.id === p.id)?.metrics || "{}") }));
      return { id: c.id, cycle: c.cycle, angle: c.angle, template: c.template, format: c.format, headline: J(c.copy).headline, posts: ps.length, clicks, platform };
    });
    const tracking = !!publicBase(st);
    const recent = storage.listSnapshots(m.id).slice(-3).map((s) => J(s.data));
    const lowTraction = tracking ? sinceClicks.length < 5 : true;
    storage.addEvent(m.ownerId, m.id, "info", `Metrics: ${sinceClicks.length} clicks since last check · ${allClicks.length} total`, tracking ? `${posts.length} live posts` : "Click tracking needs a public Looi URL (Settings). Using platform metrics where available.");

    setStage(job, "Strategist thinking", 50);
    const brief = J(m.brief);
    const connected = storage.listChannels(m.ownerId).filter((c) => c.status === "connected").map((c) => (c.type === "composio" ? J(c.config).toolkit : c.type));
    const usedPlaybooks = storage.listPlaybooks(m.id).map((p) => p.channel);
    const sys = `You are Looi's autonomous growth strategist. Mission: make this product a hit by any legitimate means. You run every few hours. Analyze real metrics, decide what to do next, and escalate to new routes when traction is weak (new angle → new format → new channel → community launches → SEO content → partnerships/influencers → conversion fixes on the site). Never repeat an angle that underperformed. Be concrete. Language: ${st.language}.`;
    const user = `PRODUCT: ${JSON.stringify(brief.product || {})}
CYCLE: ${cycle}
SITE NOW: HTTP ${site.status}, TTFB ${site.ttfbMs}ms, mobile perf ${perf ?? "n/a"}, LCP ${lcp || "n/a"}
RECENT SNAPSHOTS: ${JSON.stringify(recent)}
CREATIVES & RESULTS: ${JSON.stringify(perCreative.slice(0, 16))}
CLICKS SINCE LAST CHECK: ${tracking ? sinceClicks.length : "tracking disabled"}; LOW TRACTION FLAG: ${lowTraction}
CONNECTED AUTO-PUBLISH CHANNELS: ${JSON.stringify(connected)}
PLAYBOOKS ALREADY GIVEN: ${JSON.stringify(usedPlaybooks)}
SITE ISSUES (top): ${JSON.stringify((J(m.report).ai?.issues || []).slice(0, 5).map((i: any) => i.title))}

Return JSON:
{"assessment": string (2-3 sentences, cite numbers),
 "decision": "scale"|"iterate"|"pivot",
 "reasoning": string,
 "nextAngle": ${ANGLE_SCHEMA},
 "template": "kinetic"|"tour"|"problem"|"spotlight",
 "format": "square"|"story"|"landscape",
 "newRoutes": [{"channel": string, "why": string}] (1-3, routes not yet tried),
 "playbooks": [{"channel": string, "title": string, "content": string (complete, ready to paste)}] (1-2 NEW ones for routes without API),
 "siteFixes": string[] (0-3, only if conversion/perf is blocking),
 "userUpdate": string (short friendly update for the founder, 1-2 sentences)}`;
    const { data: plan, via } = await chatJson<any>(st, sys, user, { maxTokens: 5000, temperature: 0.8 });
    m = storage.updateMission(missionId, { strategy: JSON.stringify({ ...plan, via, cycle, at: Date.now() }) });
    storage.addEvent(m.ownerId, m.id, "decision", `Strategist: ${String(plan.decision || "iterate").toUpperCase()} — ${plan.nextAngle?.name || "new angle"}`, `${plan.assessment || ""}\n${plan.reasoning || ""}`);
    for (const pb of (plan.playbooks || []).slice(0, 2)) storage.addPlaybook({ ownerId: m.ownerId, missionId: m.id, cycle, channel: pb.channel, title: pb.title, content: pb.content });

    setStage(job, "Producing new ad", 65);
    const made: Creative[] = [];
    if (up && plan.nextAngle) {
      const tpl: TemplateKey = (TEMPLATES as readonly string[]).includes(plan.template) ? plan.template : "kinetic";
      const fmt: FormatKey = ["square", "story", "landscape"].includes(plan.format) ? plan.format : "square";
      const c = await produceCreative(m, cycle, plan.nextAngle, tpl, fmt);
      if (c) made.push(c);
    }

    setStage(job, "Reporting", 92);
    const health = computeHealth(site, perf !== undefined ? ({ scores: { performance: perf, accessibility: J(m.report).lighthouse?.mobile?.scores?.accessibility ?? 70, bestPractices: J(m.report).lighthouse?.mobile?.scores?.bestPractices ?? 70, seo: J(m.report).lighthouse?.mobile?.scores?.seo ?? 70 } } as any) : undefined);
    storage.addSnapshot(m.id, cycle, { health, perf, ttfb: site.ttfbMs, clicks: allClicks.length, newClicks: sinceClicks.length, decision: plan.decision });
    const interval = billing.intervalFor(m.ownerId, st.intervalMinutes || 150);
    m = storage.updateMission(missionId, { status: storage.getMission(missionId)!.status === "paused" ? "paused" : "active", cycle, stage: "Monitoring", progress: 100, lastCheckAt: Date.now(), nextCheckAt: Date.now() + interval * 60000, healthScore: health });
    if (made.length) requestPublish(m, made, plan.reasoning || "");
    storage.notify(m.ownerId, { title: `Cycle ${cycle} update · ${m.name}`, body: plan.userUpdate || plan.assessment || "Check complete.", kind: "update", missionId: m.id });
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 400);
    storage.addEvent(m.ownerId, m.id, "error", `Cycle ${cycle} failed`, msg);
    const interval = billing.intervalFor(m.ownerId, st.intervalMinutes || 150);
    storage.updateMission(missionId, { status: "active", stage: "Monitoring", progress: 100, lastError: msg, nextCheckAt: Date.now() + Math.min(interval, 30) * 60000 });
    storage.notify(m.ownerId, { title: `Check failed · ${m.name}`, body: msg + " — retrying soon.", kind: "error", missionId: m.id });
  } finally {
    live.delete(missionId);
  }
}

/** Generate one more ad on demand */
export async function generateMore(missionId: number) {
  const m = storage.getMission(missionId)!;
  const brief = J(m.brief);
  const job: LiveJob = { missionId, ownerId: m.ownerId, name: m.name, favicon: m.favicon, kind: "generate", stage: "Producing ads", progress: 30, startedAt: Date.now(), steps: [{ label: "Producing ads", done: false }] };
  live.set(missionId, job);
  try {
    const angles = brief.angles || [];
    const n = storage.listCreatives(m.id).length;
    const a = angles[n % Math.max(angles.length, 1)];
    const tpl = TEMPLATES[n % TEMPLATES.length];
    const fmt: FormatKey = (["square", "story", "landscape"] as FormatKey[])[n % 3];
    if (a) {
      const c = await produceCreative(m, m.cycle, a, tpl, fmt);
      if (c) requestPublish(storage.getMission(missionId)!, [c], "Manual generation");
    }
  } finally {
    live.delete(missionId);
  }
}

// ---------- scheduler (24/7 loop)
export function startScheduler() {
  // recover after restart
  for (const m of storage.missionsByStatus("running")) {
    if (!m.brief || m.brief === "{}") {
      storage.updateMission(m.id, { status: "queued" });
    } else storage.updateMission(m.id, { status: "active", nextCheckAt: Date.now() + 60000 });
  }
  for (const m of storage.missionsByStatus("queued")) enqueue(m.id, "launch", () => launchMission(m.id));
  const tick = () => {
    for (const m of storage.dueMissions()) enqueue(m.id, "check", () => checkMission(m.id));
  };
  setInterval(tick, 30000);
  setTimeout(tick, 5000);
}
