import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { getBrowser, chromePath, exclusive } from "./browser";
import { DATA_DIR } from "../storage";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 LooiAgent/1.0";

export function normalizeUrl(input: string) {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u);
  return parsed.toString();
}

export function mediaPath(name: string) {
  return path.join(DATA_DIR, "media", name);
}

async function timedFetch(url: string, init: RequestInit = {}, timeout = 20000) {
  const t0 = performance.now();
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(timeout), ...init });
  const ttfb = performance.now() - t0;
  const buf = Buffer.from(await res.arrayBuffer());
  const total = performance.now() - t0;
  return { res, buf, ttfb, total };
}

const TECH: [string, (html: string, h: Record<string, string>) => boolean][] = [
  ["Next.js", (x) => /__NEXT_DATA__|\/_next\//.test(x)],
  ["Nuxt", (x) => /__NUXT__|\/_nuxt\//.test(x)],
  ["React", (x) => /react(-dom)?(\.production)?(\.min)?\.js|data-reactroot|__NEXT_DATA__/.test(x)],
  ["Vue", (x) => /vue(\.runtime)?(\.global)?(\.prod)?\.js|data-v-[a-f0-9]{6}/.test(x)],
  ["Angular", (x) => /ng-version=|angular(\.min)?\.js/.test(x)],
  ["Svelte", (x) => /svelte-[a-z0-9]{5,}|__sveltekit/.test(x)],
  ["Astro", (x) => /astro-island|data-astro-cid/.test(x)],
  ["Vite", (x) => /\/assets\/index-[\w-]+\.js|@vite\/client/.test(x)],
  ["WordPress", (x) => /wp-content|wp-includes/.test(x)],
  ["Shopify", (x) => /cdn\.shopify\.com|Shopify\.theme/.test(x)],
  ["Webflow", (x) => /webflow\.(js|css)|data-wf-page/.test(x)],
  ["Wix", (x) => /static\.wixstatic\.com|wix-bolt/.test(x)],
  ["Framer", (x) => /framerusercontent\.com|data-framer/.test(x)],
  ["Tailwind CSS", (x) => /class="[^"]*\b(?:flex|grid) [^"]*\b(?:px|py|mt|mb)-\d/.test(x)],
  ["Google Analytics", (x) => /gtag\(|google-analytics\.com|googletagmanager\.com\/gtag/.test(x)],
  ["Google Tag Manager", (x) => /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/.test(x)],
  ["Meta Pixel", (x) => /connect\.facebook\.net\/.*fbevents\.js|fbq\(/.test(x)],
  ["Hotjar", (x) => /static\.hotjar\.com/.test(x)],
  ["Stripe", (x) => /js\.stripe\.com/.test(x)],
  ["Intercom", (x) => /widget\.intercom\.io|intercomSettings/.test(x)],
  ["Crisp", (x) => /client\.crisp\.chat/.test(x)],
  ["Cloudflare", (_x, h) => !!h["cf-ray"] || /cloudflare/i.test(h["server"] || "")],
  ["Vercel", (_x, h) => !!h["x-vercel-id"] || /vercel/i.test(h["server"] || "")],
  ["Netlify", (_x, h) => /netlify/i.test(h["server"] || "") || !!h["x-nf-request-id"]],
  ["Nginx", (_x, h) => /nginx/i.test(h["server"] || "")],
];

const SEC_HEADERS = ["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"];

export interface SiteData {
  url: string;
  finalUrl: string;
  status: number;
  https: boolean;
  redirects: boolean;
  ttfbMs: number;
  htmlLoadMs: number;
  htmlBytes: number;
  compression: string;
  server: string;
  title: string;
  description: string;
  lang: string;
  viewport: boolean;
  canonical: string;
  themeColor: string;
  favicon: string;
  ogImage: string;
  og: Record<string, string>;
  twitterCard: boolean;
  h1: string[];
  h2: string[];
  ctas: string[];
  wordCount: number;
  images: number;
  imagesNoAlt: number;
  internalLinks: number;
  externalLinks: number;
  scripts: number;
  stylesheets: number;
  forms: number;
  schemaTypes: string[];
  bodyText: string;
  tech: string[];
  securityHeaders: Record<string, boolean>;
  robotsTxt: boolean;
  sitemap: boolean;
  brokenLinks: { url: string; status: number }[];
  checkedLinks: number;
}

export async function fetchSite(url: string): Promise<SiteData> {
  const { res, buf, ttfb, total } = await timedFetch(url);
  const html = buf.toString("utf8");
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  const finalUrl = res.url || url;
  const origin = new URL(finalUrl).origin;
  const $ = cheerio.load(html);
  const abs = (h?: string) => {
    if (!h) return "";
    try {
      return new URL(h, finalUrl).toString();
    } catch {
      return "";
    }
  };
  const meta = (sel: string) => $(sel).attr("content")?.trim() || "";
  const og: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    og[$(el).attr("property")!.slice(3)] = $(el).attr("content") || "";
  });
  const icons = $('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]')
    .map((_, el) => ({ href: $(el).attr("href"), sizes: $(el).attr("sizes") || "", rel: $(el).attr("rel") || "" }))
    .get();
  const bestIcon = icons.sort((a, b) => (parseInt(b.sizes) || (b.rel.includes("apple") ? 180 : 0)) - (parseInt(a.sizes) || (a.rel.includes("apple") ? 180 : 0)))[0];
  let internal = 0,
    external = 0;
  const internalUrls = new Set<string>();
  $("a[href]").each((_, el) => {
    const h = abs($(el).attr("href"));
    if (!h || h.startsWith("mailto:") || h.startsWith("tel:")) return;
    try {
      const u = new URL(h);
      if (u.origin === origin) {
        internal++;
        u.hash = "";
        internalUrls.add(u.toString());
      } else external++;
    } catch {}
  });
  const imgs = $("img");
  const ctas = new Set<string>();
  $("a, button").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    const cls = ($(el).attr("class") || "").toLowerCase();
    if (t && t.length <= 32 && (/btn|button|cta|primary/.test(cls) || el.tagName === "button" || /get started|sign up|try|start|download|buy|book|join|free|demo|subscribe|order|contact/i.test(t))) ctas.add(t);
  });
  const schemaTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).text());
      const arr = Array.isArray(j) ? j : j["@graph"] || [j];
      for (const x of arr) if (x?.["@type"]) schemaTypes.push(String(x["@type"]));
    } catch {}
  });
  $("script, style, noscript, svg").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  const [robots, sitemap] = await Promise.all(
    ["/robots.txt", "/sitemap.xml"].map((p) =>
      fetch(origin + p, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) })
        .then(async (r) => r.ok && !(await r.text()).toLowerCase().includes("<html"))
        .catch(() => false),
    ),
  );

  // broken links check (sample)
  const sample = [...internalUrls].slice(0, 15);
  const broken: { url: string; status: number }[] = [];
  let idx = 0;
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (idx < sample.length) {
        const u = sample[idx++];
        try {
          let r = await fetch(u, { method: "HEAD", redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
          if (r.status === 405 || r.status === 403) r = await fetch(u, { redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
          if (r.status >= 400) broken.push({ url: u, status: r.status });
        } catch {
          broken.push({ url: u, status: 0 });
        }
      }
    }),
  );

  return {
    url,
    finalUrl,
    status: res.status,
    https: finalUrl.startsWith("https://"),
    redirects: res.redirected,
    ttfbMs: Math.round(ttfb),
    htmlLoadMs: Math.round(total),
    htmlBytes: buf.length,
    compression: headers["content-encoding"] || "none",
    server: headers["server"] || "",
    title: $("title").first().text().trim(),
    description: meta('meta[name="description"]') || og.description || "",
    lang: $("html").attr("lang") || "",
    viewport: $('meta[name="viewport"]').length > 0,
    canonical: $('link[rel="canonical"]').attr("href") || "",
    themeColor: meta('meta[name="theme-color"]'),
    favicon: abs(bestIcon?.href) || origin + "/favicon.ico",
    ogImage: abs(og.image),
    og,
    twitterCard: $('meta[name="twitter:card"]').length > 0,
    h1: $("h1").map((_, e) => $(e).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 5),
    h2: $("h2").map((_, e) => $(e).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 12),
    ctas: [...ctas].slice(0, 10),
    wordCount: bodyText.split(" ").filter(Boolean).length,
    images: imgs.length,
    imagesNoAlt: imgs.filter((_, e) => !$(e).attr("alt")).length,
    internalLinks: internal,
    externalLinks: external,
    scripts: (html.match(/<script\b/gi) || []).length,
    stylesheets: (html.match(/<link[^>]+stylesheet/gi) || []).length,
    forms: (html.match(/<form\b/gi) || []).length,
    schemaTypes: [...new Set(schemaTypes)],
    bodyText: bodyText.slice(0, 6000),
    tech: TECH.filter(([, f]) => f(html, headers)).map(([n]) => n),
    securityHeaders: Object.fromEntries(SEC_HEADERS.map((h) => [h, !!headers[h]])),
    robotsTxt: robots,
    sitemap,
    brokenLinks: broken,
    checkedLinks: sample.length,
  };
}

export interface RenderData {
  desktopShot: string;
  mobileShot: string;
  fullShot: string;
  logoFile: string;
  logoTone: "light" | "dark";
  consoleErrors: string[];
  failedRequests: number;
  requests: number;
  transferKb: number;
  loadMs: number;
  palette: string[];
  fonts: { heading: string; body: string };
  ux: {
    ctaAboveFold: boolean;
    mobileOverflow: boolean;
    smallText: number;
    smallTapTargets: number;
    heroHeadline: string;
    navItems: number;
  };
  renderedText: string;
}

export async function renderSite(url: string, key: string): Promise<RenderData> {
  const browser = await getBrowser();
  const consoleErrors: string[] = [];
  let failed = 0,
    requests = 0,
    bytes = 0;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, deviceScaleFactor: 1 });
  await ctx.addInitScript("window.__name = (f) => f;");
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.length < 15 && consoleErrors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => consoleErrors.length < 15 && consoleErrors.push(String(e.message).slice(0, 200)));
  page.on("requestfailed", () => failed++);
  page.on("response", async (r) => {
    requests++;
    const l = Number(r.headers()["content-length"] || 0);
    bytes += l;
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(800);
  // dismiss common cookie banners
  await page
    .locator('button:has-text("Accept"), button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Got it")')
    .first()
    .click({ timeout: 1500 })
    .catch(() => undefined);
  const desktopShot = `${key}-desktop.jpg`;
  await page.screenshot({ path: mediaPath(desktopShot), type: "jpeg", quality: 82 });
  const fullShot = `${key}-full.jpg`;
  const h = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 5200));
  await page.setViewportSize({ width: 1440, height: Math.max(900, h) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: mediaPath(fullShot), type: "jpeg", quality: 70 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));

  const info = await page.evaluate(() => {
    const toHex = (c: string) => {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
      if (!m) return "";
      if (m[4] !== undefined && parseFloat(m[4]) < 0.5) return "";
      return "#" + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, "0")).join("");
    };
    const counts: Record<string, number> = {};
    const els = Array.from(document.querySelectorAll("body, body *")).slice(0, 2500) as HTMLElement[];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cs = getComputedStyle(el);
      const area = Math.min(r.width * r.height, 400000);
      const bg = toHex(cs.backgroundColor);
      if (bg) counts[bg] = (counts[bg] || 0) + area;
      if (el.matches("a,button") && bg) counts[bg] = (counts[bg] || 0) + 60000; // boost buttons (brand color)
    }
    const palette = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c)
      .slice(0, 8);
    const h1 = document.querySelector("h1") as HTMLElement | null;
    const ff = (el: Element | null) => (el ? getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim() : "");
    const vh = window.innerHeight;
    const ctaAboveFold = Array.from(document.querySelectorAll("a,button")).some((el) => {
      const r = el.getBoundingClientRect();
      const t = (el.textContent || "").trim();
      const bg = getComputedStyle(el).backgroundColor;
      return r.top < vh && r.bottom > 0 && r.width > 60 && t.length > 1 && t.length < 32 && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg);
    });
    const nav = document.querySelector("nav, header");
    return {
      palette,
      fonts: { heading: ff(h1 || document.querySelector("h2")), body: ff(document.querySelector("p") || document.body) },
      ctaAboveFold,
      heroHeadline: (h1?.innerText || "").trim().slice(0, 160),
      navItems: nav ? nav.querySelectorAll("a").length : 0,
      renderedText: document.body.innerText.replace(/\s+/g, " ").slice(0, 5000),
    };
  });

  // logo: try to capture an element shot
  let logoFile = "";
  const logo = page.locator('header [class*="logo" i] img, header img[alt*="logo" i], header a[href="/"] img, header a[href="/"] svg, [class*="logo" i] svg, a[class*="logo" i], header img').first();
  try {
    const box = await logo.boundingBox({ timeout: 1500 });
    if (box && box.width > 16 && box.height > 10 && box.width < 500) {
      logoFile = `${key}-logo.png`;
      await logo.screenshot({ path: mediaPath(logoFile), omitBackground: true, timeout: 3000 });
    }
  } catch {
    logoFile = "";
  }
  let logoTone: "light" | "dark" = "dark";
  if (logoFile) {
    const b64 = readMediaB64(logoFile);
    logoTone = await page
      .evaluate(async (src) => {
        const im = new Image();
        im.src = src;
        await im.decode();
        const c = document.createElement("canvas");
        c.width = Math.min(im.width, 300);
        c.height = Math.round((im.height * c.width) / im.width) || 1;
        const x = c.getContext("2d")!;
        x.drawImage(im, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let sum = 0, n = 0, opaque = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 200) { opaque++; sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
        }
        const avg = n ? sum / n : 0;
        // if logo is a fully opaque box with a dark bg it's effectively "dark" artwork container
        return avg > 150 ? "light" : "dark";
      }, `data:image/png;base64,${b64}`)
      .catch(() => "dark" as const);
  }
  await ctx.close();

  // mobile
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA.replace("Windows NT 10.0; Win64; x64", "iPhone; CPU iPhone OS 18_0 like Mac OS X") + " Mobile" });
  await mctx.addInitScript("window.__name = (f) => f;");
  const mp = await mctx.newPage();
  await mp.goto(url, { waitUntil: "load", timeout: 45000 }).catch(() => undefined);
  await mp.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => undefined);
  await mp.waitForTimeout(700);
  const mobileShot = `${key}-mobile.jpg`;
  await mp.screenshot({ path: mediaPath(mobileShot), type: "jpeg", quality: 82 });
  const mux = await mp.evaluate(() => {
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 4;
    let small = 0,
      tap = 0;
    document.querySelectorAll("p, span, li, a, button, label").forEach((el) => {
      const cs = getComputedStyle(el);
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (el.textContent || "").trim().length > 2 && parseFloat(cs.fontSize) < 12) small++;
      if (el.matches("a,button") && r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32)) tap++;
    });
    return { overflow, small, tap };
  });
  await mctx.close();

  return {
    desktopShot,
    mobileShot,
    fullShot,
    logoFile,
    logoTone,
    consoleErrors,
    failedRequests: failed,
    requests,
    transferKb: Math.round(bytes / 1024),
    loadMs,
    palette: info.palette,
    fonts: info.fonts,
    ux: {
      ctaAboveFold: info.ctaAboveFold,
      mobileOverflow: mux.overflow,
      smallText: mux.small,
      smallTapTargets: mux.tap,
      heroHeadline: info.heroHeadline,
      navItems: info.navItems,
    },
    renderedText: info.renderedText,
  };
}

export interface LighthouseData {
  source: "lighthouse-local" | "pagespeed-api";
  strategy: "mobile" | "desktop";
  scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
  metrics: Record<string, { value: number; display: string; score: number | null }>;
  opportunities: { id: string; title: string; savingsMs: number; display: string }[];
  failed: { id: string; title: string; category: string }[];
}

function extractLhr(lhr: any, source: LighthouseData["source"], strategy: LighthouseData["strategy"]): LighthouseData {
  const c = lhr.categories;
  const sc = (k: string) => Math.round((c[k]?.score ?? 0) * 100);
  const m = (id: string) => {
    const a = lhr.audits[id];
    return { value: a?.numericValue ?? 0, display: a?.displayValue ?? "–", score: a?.score ?? null };
  };
  const opportunities = Object.values<any>(lhr.audits)
    .filter((a) => a.details?.type === "opportunity" && (a.score ?? 1) < 0.9 && (a.details?.overallSavingsMs || 0) > 50)
    .sort((a, b) => (b.details.overallSavingsMs || 0) - (a.details.overallSavingsMs || 0))
    .slice(0, 8)
    .map((a) => ({ id: a.id, title: a.title, savingsMs: Math.round(a.details.overallSavingsMs || 0), display: a.displayValue || "" }));
  const failed: LighthouseData["failed"] = [];
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
    source,
    strategy,
    scores: { performance: sc("performance"), accessibility: sc("accessibility"), bestPractices: sc("best-practices"), seo: sc("seo") },
    metrics: {
      fcp: m("first-contentful-paint"),
      lcp: m("largest-contentful-paint"),
      tbt: m("total-blocking-time"),
      cls: m("cumulative-layout-shift"),
      si: m("speed-index"),
      tti: m("interactive"),
    },
    opportunities,
    failed: failed.slice(0, 25),
  };
}

export async function runLighthouse(url: string, strategy: "mobile" | "desktop", psiKey = "", categories = ["performance", "accessibility", "best-practices", "seo"]): Promise<LighthouseData> {
  try {
    const lighthouse = (await import("lighthouse")).default;
    const cl = await import("chrome-launcher");
    const chrome = await cl.launch({ chromePath: chromePath(), chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
    try {
      const desktop = strategy === "desktop";
      const r: any = await lighthouse(
        url,
        { port: chrome.port, output: "json", logLevel: "error", onlyCategories: categories, maxWaitForLoad: 45000 },
        desktop
          ? {
              extends: "lighthouse:default",
              settings: {
                formFactor: "desktop",
                screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
                throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
              },
            }
          : undefined,
      );
      if (!r?.lhr) throw new Error("Lighthouse returned nothing");
      if (r.lhr.runtimeError) throw new Error(r.lhr.runtimeError.message);
      return extractLhr(r.lhr, "lighthouse-local", strategy);
    } finally {
      await chrome.kill();
    }
  } catch (e) {
    // fallback: Google PageSpeed Insights API
    const q = new URLSearchParams({ url, strategy });
    categories.forEach((c) => q.append("category", c.toUpperCase().replace("-", "_")));
    psiKey = psiKey || process.env.PSI_API_KEY || process.env.GOOGLE_PSI_KEY || "";
    if (psiKey) q.set("key", psiKey);
    const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw new Error(`Lighthouse failed (${(e as Error).message}); PageSpeed API ${r.status}`);
    const j: any = await r.json();
    return extractLhr(j.lighthouseResult, "pagespeed-api", strategy);
  }
}

export const heavy = exclusive;

export function readMediaB64(name: string) {
  try {
    return fs.readFileSync(mediaPath(name)).toString("base64");
  } catch {
    return "";
  }
}
