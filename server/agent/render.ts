import { spawn } from "node:child_process";
import fs from "node:fs";
import { getBrowser } from "./browser";
import { mediaPath, readMediaB64 } from "./analyze";

export const FORMATS = {
  square: { w: 1080, h: 1080, label: "1:1 Feed" },
  story: { w: 1080, h: 1920, label: "9:16 Story / Reel" },
  landscape: { w: 1920, h: 1080, label: "16:9 Video" },
} as const;
export type FormatKey = keyof typeof FORMATS;
export const TEMPLATES = ["kinetic", "tour", "problem", "spotlight"] as const;
export type TemplateKey = (typeof TEMPLATES)[number];

export interface AdCopy {
  hook: string;
  headline: string;
  sub: string;
  pain: string;
  benefits: string[];
  cta: string;
  captions: Record<string, string>;
  hashtags: string[];
}

export interface Brand {
  name: string;
  domain: string;
  primary: string;
  dark: string;
  light: string;
  logoFile: string;
  logoTone?: "light" | "dark";
  desktopShot: string;
  mobileShot: string;
  fullShot: string;
  aiVisual?: string;
}

// ---------- color helpers
function hexToRgb(h: string) {
  const m = h.replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function rgbToHsl([r, g, b]: number[]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}
function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

export function deriveBrand(palette: string[], themeColor: string): { primary: string; dark: string; light: string } {
  const cands = [themeColor, ...palette].filter(Boolean);
  let best: number[] | null = null;
  let bestScore = -1;
  for (const c of cands) {
    const rgb = hexToRgb(c);
    if (!rgb) continue;
    const [, s, l] = rgbToHsl(rgb);
    const score = s * (1 - Math.abs(l - 0.52) * 1.6);
    if (score > bestScore) { bestScore = score; best = rgb; }
  }
  let [h, s, l] = best && bestScore > 0.12 ? rgbToHsl(best) : [262, 0.85, 0.6];
  s = Math.max(s, 0.55);
  l = Math.min(Math.max(l, 0.48), 0.64);
  return { primary: hsl(h, s, l), dark: hsl(h, Math.min(s, 0.45), 0.07), light: hsl(h, Math.min(s, 0.6), 0.96) };
}

const esc = (s: string) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function img(name?: string, mime = "image/jpeg") {
  if (!name) return "";
  const b = readMediaB64(name);
  return b ? `data:${name.endsWith(".png") ? "image/png" : mime};base64,${b}` : "";
}

export const DURATION = 8; // seconds

function baseCss(b: Brand, fmt: FormatKey) {
  return `
  @import url('https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700,500&f[]=satoshi@400,500,700&display=block');
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100vw;height:100vh;overflow:hidden}
  :root{--u:min(1vw,1vh);--p:${b.primary};--d:${b.dark};--l:${b.light};}
  body{font-family:'Satoshi',system-ui,sans-serif;background:var(--d);color:#fff;-webkit-font-smoothing:antialiased;position:relative}
  .disp{font-family:'Cabinet Grotesk','Satoshi',sans-serif;font-weight:800;letter-spacing:-0.035em;line-height:.95}
  .bg{position:absolute;inset:0;background:
     radial-gradient(60% 50% at 20% 10%, color-mix(in oklab,var(--p) 55%,transparent), transparent 70%),
     radial-gradient(50% 45% at 90% 90%, color-mix(in oklab,var(--p) 35%,transparent), transparent 70%), var(--d);
     animation:drift 8s linear both}
  @keyframes drift{from{transform:scale(1.15) rotate(0deg)}to{transform:scale(1.3) rotate(6deg)}}
  .grain{position:absolute;inset:0;opacity:.08;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");mix-blend-mode:overlay}
  .logo{position:absolute;top:calc(var(--u)*5);left:calc(var(--u)*5);display:flex;align-items:center;gap:calc(var(--u)*1.6);font-weight:700;font-size:calc(var(--u)*3.2);animation:fadeIn .6s .2s both;z-index:5}
  .logo img{height:calc(var(--u)*5.2);max-width:calc(var(--u)*26);object-fit:contain;filter:drop-shadow(0 2px 10px rgba(0,0,0,.35))}
  .logo .chip{background:rgba(255,255,255,.95);border-radius:calc(var(--u)*1.4);padding:calc(var(--u)*1) calc(var(--u)*1.6);display:flex}
  .cta{display:inline-flex;align-items:center;gap:calc(var(--u)*1.4);background:var(--p);color:#fff;font-weight:700;font-size:calc(var(--u)*3.6);padding:calc(var(--u)*2.4) calc(var(--u)*4.4);border-radius:999px;box-shadow:0 0 0 0 color-mix(in oklab,var(--p) 60%,transparent),0 calc(var(--u)*1.6) calc(var(--u)*5) color-mix(in oklab,var(--p) 50%,transparent)}
  .cta svg{width:calc(var(--u)*3.4);height:calc(var(--u)*3.4)}
  .domain{font-size:calc(var(--u)*2.6);opacity:.75;font-weight:500;letter-spacing:.02em}
  .browser{border-radius:calc(var(--u)*1.8);overflow:hidden;background:#fff;box-shadow:0 calc(var(--u)*4) calc(var(--u)*12) rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.12)}
  .bar{height:calc(var(--u)*4);background:#f1f1f4;display:flex;align-items:center;gap:calc(var(--u)*.9);padding:0 calc(var(--u)*1.8)}
  .bar i{width:calc(var(--u)*1.2);height:calc(var(--u)*1.2);border-radius:50%;background:#d4d4da;display:block}
  .bar span{margin-left:calc(var(--u)*1.6);flex:1;height:calc(var(--u)*2.3);border-radius:999px;background:#fff;color:#666;font-size:calc(var(--u)*1.5);display:flex;align-items:center;padding-left:calc(var(--u)*1.4)}
  .viewport{position:relative;overflow:hidden;background:#fff}
  .viewport img{width:100%;display:block}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes up{from{opacity:0;transform:translateY(calc(var(--u)*6));filter:blur(calc(var(--u)*1))}to{opacity:1;transform:none;filter:blur(0)}}
  @keyframes pop{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
  @keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in oklab,var(--p) 70%,transparent),0 calc(var(--u)*1.6) calc(var(--u)*5) color-mix(in oklab,var(--p) 50%,transparent)}100%{box-shadow:0 0 0 calc(var(--u)*3) transparent,0 calc(var(--u)*1.6) calc(var(--u)*5) color-mix(in oklab,var(--p) 50%,transparent)}}
  .f-${fmt}{}
  `;
}

const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

function logoHtml(b: Brand) {
  const l = img(b.logoFile, "image/png");
  return l ? `<div class="logo">${b.logoTone === "light" ? `<img src="${l}"/>` : `<span class="chip"><img src="${l}"/></span>`}</div>` : `<div class="logo"><span>${esc(b.name)}</span></div>`;
}

function words(text: string, start: number, step = 0.11, cls = "") {
  return esc(text)
    .split(/\s+/)
    .map((w, i) => `<span class="w ${cls}" style="animation-delay:${(start + i * step).toFixed(2)}s">${w}</span>`)
    .join(" ");
}

export function buildAdHtml(t: TemplateKey, fmt: FormatKey, b: Brand, c: AdCopy): string {
  const css = baseCss(b, fmt);
  const portrait = fmt === "story";
  const land = fmt === "landscape";
  const full = img(b.fullShot) || img(b.desktopShot);
  const desk = img(b.desktopShot);
  const mob = img(b.mobileShot);
  const ctaEl = (delay: number) => `<div class="ctaWrap" style="animation:pop .6s ${delay}s both"><span class="cta" style="animation:pulse 1.4s ${delay + 0.6}s 3 both">${esc(c.cta)} ${arrow}</span></div>`;

  if (t === "kinetic") {
    return `<!doctype html><html><head><style>${css}
    .w{display:inline-block;animation:up .55s cubic-bezier(.2,.8,.2,1) both}
    .stage{position:absolute;inset:0;display:flex;flex-direction:${land ? "row" : "column"};align-items:${land ? "center" : "stretch"};padding:calc(var(--u)*${land ? 8 : 6});padding-top:calc(var(--u)*${portrait ? 18 : 14});gap:calc(var(--u)*${land ? 6 : 4})}
    .copy{flex:${land ? "1.05" : "none"};position:relative;z-index:3}
    .hook{font-size:calc(var(--u)*${portrait ? 4.4 : 3.8});color:var(--l);opacity:.9;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:calc(var(--u)*2.4)}
    .hook .w{animation-duration:.4s}
    h1{font-size:calc(var(--u)*${portrait ? 10.5 : land ? 8.6 : 8.4})}
    h1 .w:nth-child(3n){color:var(--p);filter:brightness(1.35)}
    .sub{font-size:calc(var(--u)*${portrait ? 3.6 : 3.1});opacity:.82;margin-top:calc(var(--u)*2.6);max-width:30ch;line-height:1.35;animation:up .6s 2.5s both}
    .ctaRow{display:flex;align-items:center;gap:calc(var(--u)*3);margin-top:calc(var(--u)*4);flex-wrap:wrap}
    .shot{flex:1;position:relative;min-height:0;perspective:1600px;z-index:2}
    .browser{position:${land ? "relative" : "absolute"};${land ? "" : "left:0;right:0;top:0;"}animation:rise 1.4s 2.9s cubic-bezier(.16,1,.3,1) both;transform-origin:50% 0}
    @keyframes rise{from{opacity:0;transform:translateY(calc(var(--u)*30)) rotateX(28deg) scale(.92)}to{opacity:1;transform:none}}
    .viewport{height:calc(var(--u)*${portrait ? 78 : land ? 52 : 46})}
    .viewport img{animation:scroll 4.2s 3.6s cubic-bezier(.65,0,.35,1) both}
    @keyframes scroll{from{transform:translateY(0)}to{transform:translateY(-38%)}}
    </style></head><body class="f-${fmt}"><div class="bg"></div><div class="grain"></div>${logoHtml(b)}
    <div class="stage"><div class="copy"><div class="hook">${words(c.hook, 0.4, 0.09)}</div>
    <h1 class="disp">${words(c.headline, 1.15, 0.14)}</h1><p class="sub">${esc(c.sub)}</p>
    <div class="ctaRow">${ctaEl(5.4)}<span class="domain" style="animation:fadeIn .5s 5.9s both">${esc(b.domain)}</span></div></div>
    <div class="shot"><div class="browser"><div class="bar"><i></i><i></i><i></i><span>${esc(b.domain)}</span></div><div class="viewport"><img src="${full}"/></div></div></div></div>
    </body></html>`;
  }

  if (t === "tour") {
    const chips = c.benefits.slice(0, 3);
    return `<!doctype html><html><head><style>${css}
    .stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:calc(var(--u)*6);padding-top:calc(var(--u)*${portrait ? 16 : 12});gap:calc(var(--u)*4)}
    h1{font-size:calc(var(--u)*${portrait ? 8.6 : land ? 6.4 : 7});text-align:center;max-width:${land ? "26ch" : "16ch"};animation:up .7s .4s both}
    h1 em{font-style:normal;color:var(--p);filter:brightness(1.35)}
    .frame{position:relative;width:${land ? "62%" : portrait ? "92%" : "84%"};animation:rise 1.1s .9s cubic-bezier(.16,1,.3,1) both}
    @keyframes rise{from{opacity:0;transform:translateY(calc(var(--u)*16)) scale(.94)}to{opacity:1;transform:none}}
    .viewport{height:calc(var(--u)*${portrait ? 82 : land ? 54 : 50})}
    .viewport img{animation:scroll 5.6s 1.6s cubic-bezier(.45,0,.2,1) both}
    @keyframes scroll{0%{transform:translateY(0)}45%{transform:translateY(-22%)}100%{transform:translateY(-55%)}}
    .chip{position:absolute;background:rgba(255,255,255,.96);color:#111;font-weight:700;font-size:calc(var(--u)*${portrait ? 3 : 2.5});padding:calc(var(--u)*1.8) calc(var(--u)*2.6);border-radius:calc(var(--u)*2);box-shadow:0 calc(var(--u)*2) calc(var(--u)*6) rgba(0,0,0,.4);display:flex;align-items:center;gap:calc(var(--u)*1.4);max-width:${land ? "34ch" : "22ch"};line-height:1.2;animation:pop .55s both}
    .chip b{width:calc(var(--u)*3.4);height:calc(var(--u)*3.4);flex:none;border-radius:50%;background:var(--p);color:#fff;display:grid;place-items:center;font-size:calc(var(--u)*1.9)}
    .c0{left:-${land ? 14 : 3}%;top:14%;animation-delay:2.2s}.c1{right:-${land ? 14 : 3}%;top:42%;animation-delay:3.3s}.c2{left:-${land ? 10 : 2}%;bottom:12%;animation-delay:4.4s}
    .end{display:flex;align-items:center;gap:calc(var(--u)*3);flex-wrap:wrap;justify-content:center}
    </style></head><body class="f-${fmt}"><div class="bg"></div><div class="grain"></div>${logoHtml(b)}
    <div class="stage"><h1 class="disp">${esc(c.headline).replace(/(\S+)$/, "<em>$1</em>")}</h1>
    <div class="frame"><div class="browser"><div class="bar"><i></i><i></i><i></i><span>${esc(b.domain)}</span></div><div class="viewport"><img src="${full}"/></div></div>
    ${chips.map((x, i) => `<div class="chip c${i}"><b>✓</b>${esc(x)}</div>`).join("")}</div>
    <div class="end">${ctaEl(5.8)}<span class="domain" style="animation:fadeIn .5s 6.2s both">${esc(b.domain)}</span></div></div></body></html>`;
  }

  if (t === "problem") {
    return `<!doctype html><html><head><style>${css}
    .scene{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:calc(var(--u)*${land ? 10 : 7})}
    ${land ? ".s2{right:34%}" : ""}
    .s1{animation:out .5s 2.7s both}
    @keyframes out{to{opacity:0;transform:translateY(calc(var(--u)*-6)) scale(.97);filter:blur(6px)}}
    .pain{font-size:calc(var(--u)*${portrait ? 9.6 : 8});position:relative;display:inline;color:#fff;animation:up .7s .3s both}
    .strike{position:absolute;left:-2%;top:52%;height:calc(var(--u)*1.2);width:0;background:var(--p);border-radius:999px;animation:strike .6s 1.9s cubic-bezier(.7,0,.3,1) both;box-shadow:0 0 calc(var(--u)*3) var(--p)}
    @keyframes strike{to{width:104%}}
    .kicker{font-size:calc(var(--u)*3);text-transform:uppercase;letter-spacing:.12em;opacity:.65;margin-bottom:calc(var(--u)*3);font-weight:700;animation:fadeIn .4s .2s both}
    .s2{opacity:0;animation:fadeIn .01s 2.9s both;gap:calc(var(--u)*3)}
    .meet{font-size:calc(var(--u)*3.4);opacity:.75;font-weight:700;animation:up .5s 3s both}
    h1{font-size:calc(var(--u)*${portrait ? 9.2 : 7.4});animation:up .6s 3.2s both;max-width:18ch}
    h1 em{font-style:normal;color:var(--p);filter:brightness(1.35)}
    .cards{display:grid;grid-template-columns:${land ? "repeat(3,1fr)" : "1fr"};gap:calc(var(--u)*2);margin-top:calc(var(--u)*1.5)}
    .card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(8px);padding:calc(var(--u)*2.4) calc(var(--u)*3);border-radius:calc(var(--u)*2.2);font-size:calc(var(--u)*${portrait ? 3.5 : 2.9});font-weight:600;display:flex;gap:calc(var(--u)*1.8);align-items:center;animation:up .55s both;line-height:1.25}
    .card b{flex:none;width:calc(var(--u)*4.2);height:calc(var(--u)*4.2);border-radius:calc(var(--u)*1.2);background:var(--p);display:grid;place-items:center;font-size:calc(var(--u)*2.2)}
    .end{display:flex;align-items:center;gap:calc(var(--u)*3);margin-top:calc(var(--u)*2.5);flex-wrap:wrap}
    .mini{position:absolute;right:calc(var(--u)*-6);bottom:calc(var(--u)*-8);width:${land ? "30%" : "44%"};transform:rotate(-8deg);animation:${land ? "peek 1s 3.6s cubic-bezier(.16,1,.3,1) both" : "peek 1s .7s cubic-bezier(.16,1,.3,1) both, out .5s 2.6s both"};opacity:.95;border-radius:calc(var(--u)*3);overflow:hidden;box-shadow:0 calc(var(--u)*3) calc(var(--u)*10) rgba(0,0,0,.6);border:calc(var(--u)*.8) solid #0b0b0f}
    .mini img{width:100%;display:block}
    @keyframes peek{from{opacity:0;transform:translateY(30%) rotate(-2deg)}to{opacity:.95;transform:rotate(-8deg)}}
    </style></head><body class="f-${fmt}"><div class="bg"></div><div class="grain"></div>${logoHtml(b)}
    <div class="scene s1"><div class="kicker">${esc(c.hook)}</div><div><span class="pain disp">${esc(c.pain)}<span class="strike"></span></span></div></div>
    <div class="mini">${mob ? `<img src="${mob}"/>` : `<img src="${desk}"/>`}</div>
    <div class="scene s2"><div class="meet">Meet ${esc(b.name)}</div><h1 class="disp">${esc(c.headline).replace(/(\S+)$/, "<em>$1</em>")}</h1>
    <div class="cards">${c.benefits.slice(0, 3).map((x, i) => `<div class="card" style="animation-delay:${(3.9 + i * 0.45).toFixed(2)}s"><b>${i + 1}</b>${esc(x)}</div>`).join("")}</div>
    <div class="end">${ctaEl(5.7)}<span class="domain" style="animation:fadeIn .5s 6.1s both">${esc(b.domain)}</span></div></div></body></html>`;
  }

  // spotlight
  const vis = img(b.aiVisual, "image/png") || desk;
  return `<!doctype html><html><head><style>${css}
  .vis{position:absolute;inset:0;background:url(${vis}) center/cover;animation:kb 8s linear both;${b.aiVisual ? "" : "filter:blur(22px) brightness(.55) saturate(1.3)"}}
  @keyframes kb{from{transform:scale(1.04)}to{transform:scale(1.16) translate(-1.5%,-1%)}}
  .shade{position:absolute;inset:0;background:linear-gradient(${land ? "90deg" : "0deg"}, color-mix(in oklab,var(--d) 96%,transparent) ${land ? "32%" : "30%"}, color-mix(in oklab,var(--d) 30%,transparent) ${land ? "75%" : "70%"}, transparent)}
  .stage{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:calc(var(--u)*${land ? 9 : 7});${land ? "justify-content:center;width:58%" : ""}}
  .tag{display:inline-flex;align-self:flex-start;background:color-mix(in oklab,var(--p) 85%,transparent);padding:calc(var(--u)*1) calc(var(--u)*2.2);border-radius:999px;font-weight:700;font-size:calc(var(--u)*2.4);text-transform:uppercase;letter-spacing:.08em;animation:pop .5s .6s both;margin-bottom:calc(var(--u)*2.6)}
  h1{font-size:calc(var(--u)*${portrait ? 10 : land ? 7.8 : 8.6});overflow:hidden}
  .line{display:block;overflow:hidden}.line>span{display:inline-block;animation:mask .8s cubic-bezier(.16,1,.3,1) both}
  @keyframes mask{from{transform:translateY(105%)}to{transform:none}}
  .sub{font-size:calc(var(--u)*${portrait ? 3.6 : 3});opacity:.86;margin-top:calc(var(--u)*2.6);max-width:32ch;line-height:1.35;animation:up .6s 2.4s both}
  .end{display:flex;align-items:center;gap:calc(var(--u)*3);margin-top:calc(var(--u)*4);flex-wrap:wrap}
  </style></head><body class="f-${fmt}"><div class="vis"></div><div class="shade"></div><div class="grain"></div>${logoHtml(b)}
  <div class="stage"><span class="tag">${esc(c.hook).slice(0, 40)}</span>
  <h1 class="disp">${splitLines(c.headline).map((l, i) => `<span class="line"><span style="animation-delay:${(1 + i * 0.22).toFixed(2)}s">${esc(l)}</span></span>`).join("")}</h1>
  <p class="sub">${esc(c.sub)}</p><div class="end">${ctaEl(4.6)}<span class="domain" style="animation:fadeIn .5s 5.1s both">${esc(b.domain)}</span></div></div></body></html>`;
}

function splitLines(s: string) {
  const w = s.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const x of w) {
    if ((cur + " " + x).trim().length > 14 && cur) {
      out.push(cur.trim());
      cur = x;
    } else cur += " " + x;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.slice(0, 4);
}

/** Deterministic frame-by-frame render -> MP4 + poster */
export async function renderAd(html: string, fmt: FormatKey, outBase: string, fps = 30): Promise<{ video: string; poster: string }> {
  const { w, h } = FORMATS[fmt];
  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript("window.__name = (f) => f;");
  const page = await ctx.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => (document as any).fonts?.ready).catch(() => undefined);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
    const video = `${outBase}.mp4`;
    const poster = `${outBase}.jpg`;
    const ff = spawn("ffmpeg", ["-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", mediaPath(video)], { stdio: ["pipe", "ignore", "pipe"] });
    let ffErr = "";
    ff.stderr.on("data", (d) => (ffErr = (ffErr + d).slice(-800)));
    const done = new Promise<void>((res, rej) => ff.on("close", (code) => (code === 0 ? res() : rej(new Error("ffmpeg failed: " + ffErr)))));
    const total = Math.round(DURATION * fps);
    for (let i = 0; i < total; i++) {
      const t = (i / fps) * 1000;
      await page.evaluate((ms) => document.getAnimations().forEach((a) => (a.currentTime = ms)), t);
      const buf = await page.screenshot({ type: "jpeg", quality: 90 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (i === total - 1) fs.writeFileSync(mediaPath(poster), buf);
    }
    ff.stdin.end();
    await done;
    return { video, poster };
  } finally {
    await ctx.close();
  }
}
