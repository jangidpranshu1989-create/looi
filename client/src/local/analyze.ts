/** On-device site audit: HTML via native HTTP + DOMParser, Lighthouse via Google PageSpeed Insights, screenshots from PSI. */
import { http, fetchBlob } from "./net";
import { extractLhr, psiUrl } from "./core/marketing";
import { putMedia } from "./media";

const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 LooiAgent/1.0";

export function normalizeUrl(input: string) {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return new URL(u).toString();
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

export async function fetchSite(url: string) {
  const r = await http(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, timeout: 25000 });
  const html = r.text || "";
  const headers = r.headers;
  const finalUrl = r.url || url;
  const origin = new URL(finalUrl).origin;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const abs = (h?: string | null) => {
    if (!h) return "";
    try {
      return new URL(h, finalUrl).toString();
    } catch {
      return "";
    }
  };
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content")?.trim() || "";
  const og: Record<string, string> = {};
  doc.querySelectorAll('meta[property^="og:"]').forEach((el) => (og[el.getAttribute("property")!.slice(3)] = el.getAttribute("content") || ""));
  const icons = [...doc.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon-precomposed"]')].map((el) => ({ href: el.getAttribute("href"), sizes: el.getAttribute("sizes") || "", rel: el.getAttribute("rel") || "" }));
  const sz = (i: any) => parseInt(i.sizes) || (i.rel.includes("apple") ? 180 : /\.svg/.test(i.href || "") ? 120 : 0);
  const bestIcon = icons.sort((a, b) => sz(b) - sz(a))[0];
  let internal = 0,
    external = 0;
  const internalUrls = new Set<string>();
  doc.querySelectorAll("a[href]").forEach((el) => {
    const h = abs(el.getAttribute("href"));
    if (!h || !/^https?:/.test(h)) return;
    try {
      const u = new URL(h);
      if (u.origin === origin) {
        internal++;
        u.hash = "";
        internalUrls.add(u.toString());
      } else external++;
    } catch {}
  });
  const imgs = [...doc.querySelectorAll("img")];
  const ctas = new Set<string>();
  doc.querySelectorAll("a, button").forEach((el) => {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    const cls = (el.getAttribute("class") || "").toLowerCase();
    if (t && t.length <= 32 && (/btn|button|cta|primary/.test(cls) || el.tagName === "BUTTON" || /get started|sign up|try|start|download|buy|book|join|free|demo|subscribe|order|contact/i.test(t))) ctas.add(t);
  });
  const schemaTypes: string[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      const j = JSON.parse(el.textContent || "");
      const arr = Array.isArray(j) ? j : j["@graph"] || [j];
      for (const x of arr) if (x?.["@type"]) schemaTypes.push(String(x["@type"]));
    } catch {}
  });
  // fonts (best effort from Google Fonts links / CSS text)
  const gf = [...doc.querySelectorAll('link[href*="fonts.googleapis.com"]')].map((l) => decodeURIComponent((l.getAttribute("href") || "").match(/family=([^:&]+)/)?.[1] || "").replace(/\+/g, " ")).filter(Boolean);
  const cssFam = [...html.matchAll(/font-family:\s*["']?([A-Za-z][\w \-]{1,40})["']?/g)].map((m) => m[1].trim()).filter((f) => !/inherit|system|sans-serif|serif|monospace|var/i.test(f));
  const fonts = { heading: gf[0] || cssFam[0] || "", body: gf[1] || cssFam[1] || gf[0] || cssFam[0] || "" };
  // first CTA near top of document = likely above the fold (estimate)
  const firstEls = [...doc.body?.querySelectorAll("a, button, h1") || []].slice(0, 40);
  const h1Idx = firstEls.findIndex((e) => e.tagName === "H1");
  const ctaAboveFold = firstEls.slice(0, Math.max(h1Idx + 12, 14)).some((e) => e.tagName !== "H1" && ctas.has((e.textContent || "").replace(/\s+/g, " ").trim()));
  const nav = doc.querySelector("nav, header");
  doc.querySelectorAll("script, style, noscript, svg").forEach((e) => e.remove());
  const bodyText = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();

  const [robots, sitemap] = await Promise.all(
    ["/robots.txt", "/sitemap.xml"].map((p) =>
      http(origin + p, { headers: { "User-Agent": UA }, timeout: 10000 })
        .then((x) => x.ok && !x.text.slice(0, 400).toLowerCase().includes("<html"))
        .catch(() => false),
    ),
  );
  const sample = [...internalUrls].filter((u) => u !== finalUrl).slice(0, 12);
  const broken: { url: string; status: number }[] = [];
  let idx = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (idx < sample.length) {
        const u = sample[idx++];
        try {
          let x = await http(u, { method: "HEAD", headers: { "User-Agent": UA }, timeout: 10000 });
          if (x.status === 405 || x.status === 403) x = await http(u, { headers: { "User-Agent": UA }, timeout: 10000 });
          if (x.status >= 400) broken.push({ url: u, status: x.status });
        } catch {
          broken.push({ url: u, status: 0 });
        }
      }
    }),
  );

  return {
    url,
    finalUrl,
    status: r.status,
    https: finalUrl.startsWith("https://"),
    redirects: finalUrl !== url,
    ttfbMs: r.ms,
    htmlLoadMs: r.ms,
    htmlBytes: new Blob([html]).size,
    compression: headers["content-encoding"] || (headers["server"] ? "auto" : "none"),
    server: headers["server"] || "",
    title: doc.querySelector("title")?.textContent?.trim() || "",
    description: meta('meta[name="description"]') || og.description || "",
    lang: doc.documentElement.getAttribute("lang") || "",
    viewport: !!doc.querySelector('meta[name="viewport"]'),
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || "",
    themeColor: meta('meta[name="theme-color"]'),
    favicon: abs(bestIcon?.href) || origin + "/favicon.ico",
    ogImage: abs(og.image),
    og,
    twitterCard: !!doc.querySelector('meta[name="twitter:card"]'),
    h1: [...doc.querySelectorAll("h1")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 5),
    h2: [...doc.querySelectorAll("h2")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 12),
    ctas: [...ctas].slice(0, 10),
    wordCount: bodyText.split(" ").filter(Boolean).length,
    images: imgs.length,
    imagesNoAlt: imgs.filter((e) => !e.getAttribute("alt")).length,
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
    _fonts: fonts,
    _ctaAboveFold: ctaAboveFold,
    _navItems: nav ? nav.querySelectorAll("a").length : 0,
  };
}
export type SiteData = Awaited<ReturnType<typeof fetchSite>>;

/** Run Lighthouse through Google PageSpeed Insights. Returns compact data + the raw lhr (for screenshots). */
export async function runPsi(url: string, strategy: "mobile" | "desktop", key: string, categories?: string[]) {
  let last = "";
  for (let i = 0; i < 2; i++) {
    const r = await http(psiUrl(url, strategy, key, categories), { timeout: 120000 }).catch((e) => ({ ok: false, status: 0, text: String(e.message) }) as any);
    if (r.ok) {
      const j = JSON.parse(r.text);
      if (j.lighthouseResult?.runtimeError?.code && j.lighthouseResult.runtimeError.code !== "NO_ERROR") throw new Error(j.lighthouseResult.runtimeError.message);
      return { data: extractLhr(j.lighthouseResult, strategy), lhr: j.lighthouseResult };
    }
    last = `PageSpeed ${r.status}: ${String(r.text).slice(0, 220)}`;
    if (r.status === 429 || r.status === 400) break;
  }
  if (/429|quota/i.test(last)) last += " — add a free PageSpeed API key in Settings to lift Google's shared quota.";
  throw new Error(last);
}

// ---------- colors
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const im = new Image();
  im.crossOrigin = "anonymous";
  im.src = src;
  await im.decode();
  return im;
}
export async function paletteFrom(src: string): Promise<string[]> {
  try {
    const im = await loadImage(src);
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = Math.max(1, Math.round((im.height / im.width) * 96));
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.drawImage(im, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) {
      const k = hex(d[i] & 0xf0, d[i + 1] & 0xf0, d[i + 2] & 0xf0);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
  } catch {
    return [];
  }
}
export async function toneOf(src: string): Promise<"light" | "dark"> {
  try {
    const im = await loadImage(src);
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.drawImage(im, 0, 0, 64, 64);
    const d = x.getImageData(0, 0, 64, 64).data;
    let sum = 0,
      n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) (sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]), n++;
    return n && sum / n > 150 ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function hexToRgb(h: string) {
  const m = h.replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function rgbToHsl([r, g, b]: number[]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}
const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
export function deriveBrand(palette: string[], themeColor: string) {
  const cands = [themeColor, ...palette].filter(Boolean);
  let best: number[] | null = null;
  let bestScore = -1;
  for (const c of cands) {
    const rgb = hexToRgb(c);
    if (!rgb) continue;
    const [, s, l] = rgbToHsl(rgb);
    const score = s * (1 - Math.abs(l - 0.52) * 1.6);
    if (score > bestScore) {
      bestScore = score;
      best = rgb;
    }
  }
  let [h, s, l] = best && bestScore > 0.12 ? rgbToHsl(best) : [262, 0.85, 0.6];
  s = Math.max(s, 0.55);
  l = Math.min(Math.max(l, 0.48), 0.64);
  return { primary: hsl(h, s, l), dark: hsl(h, Math.min(s, 0.45), 0.07), light: hsl(h, Math.min(s, 0.6), 0.96) };
}

const shotData = (lhr: any, id: string) => lhr?.audits?.[id]?.details?.data || lhr?.audits?.[id]?.details?.screenshot?.data || "";

/** Build the same `render` record the server produces, from PSI artefacts. */
export async function captureFromPsi(key: string, site: SiteData, lhrM: any, lhrD: any) {
  const save = async (name: string, src: string) => {
    if (!src) return "";
    const b = await fetchBlob(src);
    return b && b.size > 2000 ? putMedia(name, b) : "";
  };
  let desktopShot = await save(`${key}-desktop.jpg`, shotData(lhrD, "final-screenshot"));
  const fullShot = await save(`${key}-full.jpg`, shotData(lhrD, "full-page-screenshot"));
  const mobileShot = await save(`${key}-mobile.jpg`, shotData(lhrM, "final-screenshot"));
  if (!desktopShot) {
    // fallback: WordPress mShots (public screenshot service). First hit may return a placeholder while it renders.
    const ms = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(site.finalUrl)}?w=1440&h=900`;
    for (let i = 0; i < 4 && !desktopShot; i++) {
      const b = await fetchBlob(ms);
      if (b && b.type.includes("jpeg") && b.size > 15000) desktopShot = await putMedia(`${key}-desktop.jpg`, b);
      else await new Promise((r) => setTimeout(r, 4000));
    }
  }
  let logoFile = "";
  let logoTone: "light" | "dark" = "dark";
  if (site.favicon && !/\.ico(\?|$)/i.test(site.favicon)) {
    const b = await fetchBlob(site.favicon, 15000);
    if (b && b.size > 200 && /image/.test(b.type)) {
      logoFile = await putMedia(`${key}-logo.${b.type.includes("svg") ? "svg" : "png"}`, b);
      logoTone = await toneOf(URL.createObjectURL(b));
    }
  }
  const { getMediaUrl } = await import("./media");
  const palette = desktopShot ? await paletteFrom(getMediaUrl(desktopShot)) : [];
  const A = (l: any, id: string) => l?.audits?.[id];
  const items = (l: any, id: string) => A(l, id)?.details?.items || [];
  const fail = (l: any, id: string) => (A(l, id) && A(l, id).score !== null && A(l, id).score < 1 ? Math.max(items(l, id).length, 1) : 0);
  const lhAny = lhrM || lhrD;
  return {
    desktopShot,
    mobileShot,
    fullShot,
    logoFile,
    logoTone,
    logoKind: "icon",
    consoleErrors: items(lhrD || lhrM, "errors-in-console").map((x: any) => String(x.description || x.source || "error").slice(0, 200)).slice(0, 15),
    failedRequests: items(lhAny, "network-requests").filter((x: any) => x.statusCode >= 400).length,
    requests: lhAny ? items(lhAny, "network-requests").length : null,
    transferKb: A(lhAny, "total-byte-weight") ? Math.round(A(lhAny, "total-byte-weight").numericValue / 1024) : null,
    loadMs: Math.round(A(lhrM, "interactive")?.numericValue || 0),
    serverResponseMs: A(lhrM, "server-response-time") ? Math.round(A(lhrM, "server-response-time").numericValue) : null,
    palette,
    fonts: site._fonts,
    ux: {
      ctaAboveFold: site._ctaAboveFold,
      mobileOverflow: A(lhrM, "content-width") ? A(lhrM, "content-width").score === 0 : false,
      smallText: fail(lhrM, "font-size"),
      smallTapTargets: Math.max(fail(lhrM, "target-size"), fail(lhrM, "tap-targets")),
      heroHeadline: site.h1[0] || "",
      navItems: site._navItems,
    },
    renderedText: site.bodyText.slice(0, 5000),
    source: "pagespeed",
  };
}
