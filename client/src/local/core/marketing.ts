/** Prompts, captions, links and scoring shared by the app engine and the background runner. */
import type { Settings } from "./types";

export const TEMPLATES = ["kinetic", "tour", "problem", "spotlight"] as const;
export type TemplateKey = (typeof TEMPLATES)[number];
export const FORMATS = {
  square: { w: 1080, h: 1080, label: "1:1 Feed" },
  story: { w: 1080, h: 1920, label: "9:16 Story / Reel" },
  landscape: { w: 1920, h: 1080, label: "16:9 Video" },
} as const;
export type FormatKey = keyof typeof FORMATS;

export const ANGLE_SCHEMA = `{"name": string (angle name e.g. "Speed", "Pain killer", "Social proof"), "hook": string (<=5 words, uppercase-able kicker), "headline": string (<=7 words, punchy), "sub": string (<=16 words), "pain": string (<=6 words, a question), "benefits": [string,string,string] (<=5 words each), "cta": string (<=3 words), "captions": {"x": string (<=200 chars, include {link}), "linkedin": string (3-5 short lines, include {link}), "instagram": string (with emojis, include {link}), "telegram": string (include {link}), "generic": string (include {link})}, "hashtags": string[5]}`;

export function reportPrompt(st: Settings, facts: any) {
  const sys = `You are Looi, a senior web performance + UI/UX + CRO auditor. You receive REAL measured data (Lighthouse via Google PageSpeed, HTTP, DOM checks) and possibly a screenshot. Never invent metrics; reference the given numbers. Be specific and actionable. Language: ${st.language}.`;
  const user = `Audit this site and return JSON:
{"summary": string (3 sentences),
 "verdict": "Excellent"|"Good"|"Needs work"|"Poor",
 "uiux": {"score": 0-100, "verdict": string, "strengths": string[3-5], "problems": string[3-6]},
 "issues": [{"severity":"critical"|"high"|"medium"|"low","area":"Performance"|"SEO"|"Accessibility"|"Security"|"UX"|"Content"|"Conversion","title": string,"detail": string,"fix": string}] (6-12 items, ordered by impact),
 "quickWins": string[4-6],
 "marketingReadiness": {"score": 0-100, "notes": string}}
DATA:
${JSON.stringify(facts)}`;
  return { sys, user };
}

export function briefPrompt(st: Settings, goal: string, site: any) {
  const sys = `You are Looi, a world-class growth marketer and ad copywriter. Write copy that is specific to the product (use real features from the page), never generic. Language for copy: ${st.language}. ${st.brandVoice ? "Brand voice: " + st.brandVoice : ""}`;
  const user = `Product URL: ${site.finalUrl}
Title: ${site.title}
Description: ${site.description}
Headline on site: ${site.h1?.[0] || ""}
H2s: ${(site.h2 || []).slice(0, 10).join(" | ")}
CTAs: ${(site.ctas || []).join(", ")}
User goal: ${goal || "Get as many users/customers as possible"}
Page text: ${String(site.bodyText || "").slice(0, 3500)}

Return JSON:
{"product": {"name": string, "oneLiner": string, "category": string, "audience": string, "pains": string[3], "usps": string[4], "tone": string},
 "angles": [${ANGLE_SCHEMA}, ... 4 distinct angles],
 "channelPlan": [{"channel": string, "why": string, "priority": 1-3}] (5-7 channels incl. organic communities),
 "playbooks": [{"channel": "product_hunt"|"reddit"|"hacker_news"|"indie_hackers"|"seo_blog"|"cold_email"|"influencer_dm"|"whatsapp", "title": string, "content": string (ready-to-paste, complete)}] (3 items)}`;
  return { sys, user };
}

export interface StrategistInput {
  product: any;
  cycle: number;
  status: number;
  ttfbMs: number;
  perf?: number;
  lcp?: string;
  recent: any[];
  perCreative: any[];
  connected: string[];
  usedPlaybooks: string[];
  topIssues: string[];
}
export function strategistPrompt(st: Settings, x: StrategistInput) {
  const sys = `You are Looi's autonomous growth strategist. Mission: make this product a hit by any legitimate means. You run every few hours. Analyze real metrics, decide what to do next, and escalate to new routes when traction is weak (new angle → new format → new channel → community launches → SEO content → partnerships/influencers → conversion fixes on the site). Never repeat an angle that underperformed. Be concrete. Language: ${st.language}.`;
  const user = `PRODUCT: ${JSON.stringify(x.product || {})}
CYCLE: ${x.cycle}
SITE NOW: HTTP ${x.status}, response ${x.ttfbMs}ms, mobile perf ${x.perf ?? "n/a"}, LCP ${x.lcp || "n/a"}
RECENT SNAPSHOTS: ${JSON.stringify(x.recent)}
CREATIVES & RESULTS: ${JSON.stringify(x.perCreative.slice(0, 16))}
CLICK TRACKING: not available on-device (links carry UTM tags; read them in the founder's analytics). Treat traction as unknown/low and keep exploring new routes.
CONNECTED AUTO-PUBLISH CHANNELS: ${JSON.stringify(x.connected)}
PLAYBOOKS ALREADY GIVEN: ${JSON.stringify(x.usedPlaybooks)}
SITE ISSUES (top): ${JSON.stringify(x.topIssues)}

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
  return { sys, user };
}

export function captionFor(type: string, captions: Record<string, string>, link: string, hashtags: string[]) {
  const key = type === "facebook" ? "instagram" : type === "discord" || type === "slack" || type === "webhook" ? "generic" : type;
  let cap = captions[key] || captions.generic || captions.x || "";
  const tags = (hashtags || []).slice(0, type === "x" ? 2 : 5).map((h) => (h.startsWith("#") ? h : "#" + h.replace(/\s+/g, ""))).join(" ");
  cap = cap.includes("{link}") ? cap.replace(/\{link\}/g, link) : `${cap}\n\n${link}`;
  if (tags && !cap.includes("#")) cap += `\n\n${tags}`;
  if (type === "x" && cap.length > 280) {
    const short = (captions.x || cap).replace(/\{link\}/g, "").slice(0, 280 - link.length - 4).trim();
    cap = `${short}\n\n${link}`;
  }
  return cap;
}
export const capKeyFor = (toolkit: string) => (toolkit === "twitter" ? "x" : toolkit === "discordbot" ? "discord" : toolkit);

export function utmLink(url: string, missionId: number, code: string, source: string) {
  const u = new URL(url);
  u.searchParams.set("utm_source", source);
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", `looi-${missionId}`);
  u.searchParams.set("utm_content", code);
  return u.toString();
}
export const randCode = () => Math.random().toString(36).slice(2, 9);

export function computeHealth(site: any, lhM?: any, lhD?: any) {
  const sec = Object.values(site.securityHeaders || {}).filter(Boolean).length / 6;
  const perf = lhM ? lhM.scores.performance * 0.6 + (lhD?.scores.performance ?? lhM.scores.performance) * 0.4 : Math.max(0, 100 - (site.ttfbMs || 0) / 20);
  const a11y = lhM?.scores.accessibility ?? 70;
  const bp = lhM?.scores.bestPractices ?? 70;
  const seo = lhM?.scores.seo ?? 70;
  const security = (site.https ? 50 : 0) + sec * 50;
  return Math.round(perf * 0.3 + a11y * 0.2 + bp * 0.15 + seo * 0.2 + security * 0.15);
}

/** Lighthouse result → compact data (same shape as server). */
export function extractLhr(lhr: any, strategy: "mobile" | "desktop") {
  const c = lhr.categories || {};
  const sc = (k: string) => Math.round((c[k]?.score ?? 0) * 100);
  const m = (id: string) => {
    const a = lhr.audits?.[id];
    return { value: a?.numericValue ?? 0, display: a?.displayValue ?? "–", score: a?.score ?? null };
  };
  const opportunities = Object.values<any>(lhr.audits || {})
    .filter((a) => (a.details?.type === "opportunity" || a.metricSavings?.LCP || a.metricSavings?.FCP) && (a.score ?? 1) < 0.9 && (a.details?.overallSavingsMs || 0) > 50)
    .sort((a, b) => (b.details.overallSavingsMs || 0) - (a.details.overallSavingsMs || 0))
    .slice(0, 8)
    .map((a) => ({ id: a.id, title: a.title, savingsMs: Math.round(a.details.overallSavingsMs || 0), display: a.displayValue || "" }));
  const failed: any[] = [];
  for (const [cat, key] of [
    ["accessibility", "accessibility"],
    ["seo", "seo"],
    ["best-practices", "bestPractices"],
  ] as const) {
    for (const ref of c[cat]?.auditRefs || []) {
      const a = lhr.audits[ref.id];
      if (ref.weight > 0 && a && a.score !== null && a.score < 0.9) failed.push({ id: a.id, title: a.title, category: key });
    }
  }
  return {
    source: "pagespeed-api" as const,
    strategy,
    scores: { performance: sc("performance"), accessibility: sc("accessibility"), bestPractices: sc("best-practices"), seo: sc("seo") },
    metrics: { fcp: m("first-contentful-paint"), lcp: m("largest-contentful-paint"), tbt: m("total-blocking-time"), cls: m("cumulative-layout-shift"), si: m("speed-index"), tti: m("interactive") },
    opportunities,
    failed: failed.slice(0, 25),
  };
}

export function psiUrl(url: string, strategy: string, key: string, categories = ["performance", "accessibility", "best-practices", "seo"]) {
  // no URLSearchParams: this also runs inside the background-runner JS engine
  let q = `url=${encodeURIComponent(url)}&strategy=${strategy}`;
  categories.forEach((c) => (q += `&category=${c.toUpperCase().replace("-", "_")}`));
  if (key) q += `&key=${encodeURIComponent(key)}`;
  return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`;
}
