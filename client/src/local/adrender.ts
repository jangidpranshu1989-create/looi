/**
 * On-device production ad renderer.
 * Draws the same four motion templates as the server (kinetic, tour, problem, spotlight) on a Canvas 2D,
 * frame by frame and deterministically, then encodes H.264 MP4 with WebCodecs + mp4-muxer.
 * Falls back to MediaRecorder (real-time) when WebCodecs H.264 is unavailable.
 */
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { FORMATS, type FormatKey, type TemplateKey } from "./core/marketing";
import { loadImage } from "./analyze";
import { putMedia } from "./media";

export interface AdBrand {
  name: string;
  domain: string;
  primary: string;
  dark: string;
  light: string;
  logo?: string; // object URL
  logoTone?: "light" | "dark";
  desktop?: string;
  mobile?: string;
  full?: string;
}
export interface AdCopy {
  hook: string;
  headline: string;
  sub: string;
  pain: string;
  benefits: string[];
  cta: string;
}

export const DURATION = 8;
const FPS = 30;
const DISPLAY = '"Cabinet Grotesk", "Satoshi", system-ui, sans-serif';
const BODY = '"Satoshi", system-ui, sans-serif';

// ---------- easing & timing
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outBack = (x: number) => {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const seg = (t: number, start: number, dur: number, ease = outCubic) => ease(clamp((t - start) / dur));

// ---------- colors
function parseHsl(c: string): [number, number, number] {
  const m = c.match(/hsl\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/);
  return m ? [+m[1], +m[2], +m[3]] : [262, 85, 60];
}
const hsla = (c: string, a: number, dl = 0) => {
  const [h, s, l] = parseHsl(c);
  return `hsla(${h}, ${s}%, ${clamp(l + dl, 0, 100)}%, ${a})`;
};

// ---------- drawing primitives
type Ctx = CanvasRenderingContext2D;
function rr(x: Ctx, X: number, Y: number, w: number, h: number, r: number) {
  x.beginPath();
  if ((x as any).roundRect) (x as any).roundRect(X, Y, w, h, r);
  else {
    x.moveTo(X + r, Y);
    x.arcTo(X + w, Y, X + w, Y + h, r);
    x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r);
    x.arcTo(X, Y, X + w, Y, r);
    x.closePath();
  }
}
function font(x: Ctx, weight: number, size: number, fam = BODY, spacingEm = 0) {
  x.font = `${weight} ${size}px ${fam}`;
  try {
    (x as any).letterSpacing = `${(spacingEm * size).toFixed(2)}px`;
  } catch {}
}
interface Word {
  text: string;
  x: number;
  y: number;
  w: number;
  i: number;
  line: number;
}
function layoutWords(x: Ctx, text: string, maxW: number, lineH: number, align: "left" | "center" = "left", originX = 0): { words: Word[]; lines: number; width: number; lineWidths: number[] } {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  const space = x.measureText(" ").width;
  const lines: { words: { t: string; w: number }[]; w: number }[] = [{ words: [], w: 0 }];
  for (const p of parts) {
    const w = x.measureText(p).width;
    const cur = lines[lines.length - 1];
    const add = cur.words.length ? space + w : w;
    if (cur.w + add > maxW && cur.words.length) lines.push({ words: [{ t: p, w }], w });
    else {
      cur.words.push({ t: p, w });
      cur.w += add;
    }
  }
  const words: Word[] = [];
  let i = 0;
  lines.forEach((ln, li) => {
    let cx = align === "center" ? originX + (maxW - ln.w) / 2 : originX;
    for (const w of ln.words) {
      words.push({ text: w.t, x: cx, y: li * lineH, w: w.w, i: i++, line: li });
      cx += w.w + space;
    }
  });
  return { words, lines: lines.length, width: Math.max(...lines.map((l) => l.w), 0), lineWidths: lines.map((l) => l.w) };
}

function makeGrain(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const d = x.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}

const ARROW = new Path2D("M5 12h14M13 6l6 6-6 6");
const CHECK = new Path2D("M5 12.5l4.5 4.5L19 7.5");

interface Assets {
  logo?: HTMLImageElement;
  desktop?: HTMLImageElement;
  mobile?: HTMLImageElement;
  full?: HTMLImageElement;
  blurBg?: HTMLCanvasElement;
  grain: HTMLCanvasElement;
}

async function img(src?: string) {
  if (!src) return undefined;
  try {
    return await loadImage(src);
  } catch {
    return undefined;
  }
}

export async function ensureFonts() {
  const f = (document as any).fonts;
  if (!f) return;
  await Promise.all([f.load(`800 80px "Cabinet Grotesk"`), f.load(`700 40px "Satoshi"`), f.load(`500 40px "Satoshi"`), f.load(`400 40px "Satoshi"`)].map((p: Promise<any>) => p.catch(() => null)));
}

// ---------- scene
class Scene {
  W: number;
  H: number;
  u: number;
  land: boolean;
  portrait: boolean;
  constructor(public x: Ctx, public fmt: FormatKey, public tpl: TemplateKey, public b: AdBrand, public c: AdCopy, public a: Assets) {
    this.W = FORMATS[fmt].w;
    this.H = FORMATS[fmt].h;
    this.u = Math.min(this.W, this.H) / 100;
    this.land = fmt === "landscape";
    this.portrait = fmt === "story";
  }
  get accent() {
    return hsla(this.b.primary, 1, 12);
  }

  bg(t: number) {
    const { x, W, H, b } = this;
    x.fillStyle = b.dark;
    x.fillRect(0, 0, W, H);
    x.save();
    const s = 1.15 + (t / DURATION) * 0.15;
    x.translate(W / 2, H / 2);
    x.rotate(((t / DURATION) * 6 * Math.PI) / 180);
    x.scale(s, s);
    x.translate(-W / 2, -H / 2);
    const R = Math.max(W, H);
    let g = x.createRadialGradient(W * 0.2, H * 0.1, 0, W * 0.2, H * 0.1, R * 0.6);
    g.addColorStop(0, hsla(b.primary, 0.55));
    g.addColorStop(1, hsla(b.primary, 0));
    x.fillStyle = g;
    x.fillRect(-W, -H, W * 3, H * 3);
    g = x.createRadialGradient(W * 0.9, H * 0.9, 0, W * 0.9, H * 0.9, R * 0.5);
    g.addColorStop(0, hsla(b.primary, 0.35));
    g.addColorStop(1, hsla(b.primary, 0));
    x.fillStyle = g;
    x.fillRect(-W, -H, W * 3, H * 3);
    x.restore();
  }
  grain() {
    const { x, W, H } = this;
    x.save();
    x.globalAlpha = 0.07;
    x.globalCompositeOperation = "overlay";
    x.fillStyle = x.createPattern(this.a.grain, "repeat")!;
    x.fillRect(0, 0, W, H);
    x.restore();
  }
  logo(t: number) {
    const { x, u, b, a } = this;
    const q = seg(t, 0.2, 0.6);
    if (q <= 0) return;
    x.save();
    x.globalAlpha = q;
    let X = 5 * u;
    const Y = 5 * u;
    const h = 5.2 * u;
    if (a.logo) {
      const ar = a.logo.width / a.logo.height || 1;
      const lw = Math.min(h * ar, 26 * u);
      if (b.logoTone === "light") {
        x.drawImage(a.logo, X, Y, lw, h);
      } else {
        x.fillStyle = "rgba(255,255,255,.95)";
        rr(x, X, Y - u, lw + 2 * u, h + 2 * u, 1.4 * u);
        x.fill();
        x.drawImage(a.logo, X + u, Y, lw, h);
        X += 2 * u;
      }
      X += lw + 1.8 * u;
    }
    font(x, 700, 3.2 * u);
    x.fillStyle = "#fff";
    x.textBaseline = "middle";
    x.fillText(b.name, X, Y + h / 2);
    x.restore();
  }
  /** animated words; colorFn picks a color per word */
  words(words: Word[], ox: number, oy: number, t: number, start: number, step: number, dur: number, size: number, weight: number, fam: string, spacing: number, color: (w: Word) => string) {
    const { x, u } = this;
    font(x, weight, size, fam, spacing);
    x.textBaseline = "top";
    for (const w of words) {
      const q = seg(t, start + w.i * step, dur, (v) => 1 - Math.pow(1 - v, 3.4));
      if (q <= 0) continue;
      x.save();
      x.globalAlpha = q;
      x.fillStyle = color(w);
      x.fillText(w.text, ox + w.x, oy + w.y + (1 - q) * 6 * u);
      x.restore();
    }
  }
  block(text: string, ox: number, oy: number, maxW: number, size: number, weight: number, fam: string, lh: number, alpha: number, q: number, align: "left" | "center" = "left", color = "#fff") {
    const { x, u } = this;
    font(x, weight, size, fam);
    const L = layoutWords(x, text, maxW, size * lh, align);
    if (q > 0) {
      x.save();
      x.globalAlpha = alpha * q;
      x.fillStyle = color;
      x.textBaseline = "top";
      for (const w of L.words) x.fillText(w.text, ox + w.x, oy + w.y + (1 - q) * 6 * u);
      x.restore();
    }
    return L.lines * size * lh;
  }
  measureBlock(text: string, maxW: number, size: number, weight: number, fam: string, lh: number) {
    font(this.x, weight, size, fam);
    return layoutWords(this.x, text, maxW, size * lh).lines * size * lh;
  }
  ctaSize() {
    const { x, u } = this;
    font(x, 700, 3.6 * u);
    const tw = x.measureText(this.c.cta || "Try it").width;
    return { w: tw + 4.4 * u * 2 + 4.8 * u, h: 3.6 * u + 4.8 * u };
  }
  cta(t: number, X: number, Y: number, start: number) {
    const { x, u, b } = this;
    const q = seg(t, start, 0.6, outBack);
    if (q <= 0) return this.ctaSize();
    const { w, h } = this.ctaSize();
    x.save();
    x.globalAlpha = clamp(q * 1.6);
    x.translate(X + w / 2, Y + h / 2);
    const sc = 0.6 + 0.4 * q;
    x.scale(sc, sc);
    // pulse rings
    const pt = t - start - 0.6;
    if (pt > 0 && pt < 1.4 * 3) {
      const k = (pt % 1.4) / 1.4;
      x.save();
      x.globalAlpha = (1 - k) * 0.7;
      x.strokeStyle = hsla(b.primary, 1);
      x.lineWidth = 3 * u * k + 2;
      rr(x, -w / 2 - 1.5 * u * k, -h / 2 - 1.5 * u * k, w + 3 * u * k, h + 3 * u * k, h);
      x.stroke();
      x.restore();
    }
    x.shadowColor = hsla(b.primary, 0.5);
    x.shadowBlur = 5 * u;
    x.shadowOffsetY = 1.6 * u;
    x.fillStyle = b.primary;
    rr(x, -w / 2, -h / 2, w, h, h / 2);
    x.fill();
    x.shadowColor = "transparent";
    font(x, 700, 3.6 * u);
    x.fillStyle = "#fff";
    x.textBaseline = "middle";
    x.fillText(this.c.cta || "Try it", -w / 2 + 4.4 * u, 1);
    x.save();
    const s = (3.4 * u) / 24;
    x.translate(w / 2 - 4.4 * u - 3.4 * u, -1.7 * u);
    x.scale(s, s);
    x.strokeStyle = "#fff";
    x.lineWidth = 2.4;
    x.lineCap = "round";
    x.lineJoin = "round";
    x.stroke(ARROW);
    x.restore();
    x.restore();
    return { w, h };
  }
  domain(t: number, X: number, Y: number, start: number, align: CanvasTextAlign = "left") {
    const { x, u } = this;
    const q = seg(t, start, 0.5);
    if (q <= 0) return;
    x.save();
    x.globalAlpha = 0.75 * q;
    font(x, 500, 2.6 * u, BODY, 0.02);
    x.fillStyle = "#fff";
    x.textBaseline = "middle";
    x.textAlign = align;
    x.fillText(this.b.domain, X, Y);
    x.restore();
  }
  /** Browser chrome with scrolling screenshot. scroll = fraction of image height. */
  browser(X: number, Y: number, w: number, vh: number, image: HTMLImageElement | undefined, scroll: number) {
    const { x, u } = this;
    const bar = 4 * u;
    const r = 1.8 * u;
    x.save();
    x.shadowColor = "rgba(0,0,0,.55)";
    x.shadowBlur = 12 * u;
    x.shadowOffsetY = 4 * u;
    x.fillStyle = "#fff";
    rr(x, X, Y, w, bar + vh, r);
    x.fill();
    x.restore();
    x.save();
    rr(x, X, Y, w, bar + vh, r);
    x.clip();
    x.fillStyle = "#f1f1f4";
    x.fillRect(X, Y, w, bar);
    x.fillStyle = "#d4d4da";
    for (let i = 0; i < 3; i++) {
      x.beginPath();
      x.arc(X + 1.8 * u + 0.6 * u + i * 2.1 * u, Y + bar / 2, 0.6 * u, 0, Math.PI * 2);
      x.fill();
    }
    const px = X + 9 * u;
    x.fillStyle = "#fff";
    rr(x, px, Y + bar / 2 - 1.15 * u, w - 9 * u - 1.8 * u, 2.3 * u, 1.15 * u);
    x.fill();
    font(x, 500, 1.5 * u);
    x.fillStyle = "#666";
    x.textBaseline = "middle";
    x.fillText(this.b.domain, px + 1.4 * u, Y + bar / 2);
    if (image) {
      const ih = (image.height / image.width) * w;
      const maxScroll = Math.max(0, ih - vh);
      x.drawImage(image, X, Y + bar - Math.min(scroll * ih, maxScroll), w, ih);
    } else {
      const g = x.createLinearGradient(X, Y + bar, X, Y + bar + vh);
      g.addColorStop(0, "#f6f6f8");
      g.addColorStop(1, "#e9e9ee");
      x.fillStyle = g;
      x.fillRect(X, Y + bar, w, vh);
    }
    x.restore();
    x.save();
    x.strokeStyle = "rgba(255,255,255,.12)";
    x.lineWidth = 1;
    rr(x, X, Y, w, bar + vh, r);
    x.stroke();
    x.restore();
  }

  // ---------- templates
  kinetic(t: number) {
    const { x, u, W, H, land, portrait, c, a } = this;
    const pad = (land ? 8 : 6) * u;
    const top = (portrait ? 18 : 14) * u;
    const copyW = land ? W * 0.47 - pad : W - pad * 2;
    const hookSize = (portrait ? 4.4 : 3.8) * u;
    const h1Size = (portrait ? 10.5 : land ? 8.6 : 8.4) * u;
    const subSize = (portrait ? 3.6 : 3.1) * u;
    font(x, 700, hookSize, BODY, 0.08);
    const hook = layoutWords(x, String(c.hook || "").toUpperCase(), copyW, hookSize * 1.25);
    font(x, 800, h1Size, DISPLAY, -0.035);
    const h1 = layoutWords(x, c.headline, copyW, h1Size * 0.98);
    const subW = Math.min(copyW, subSize * 15);
    const subH = this.measureBlock(c.sub, subW, subSize, 400, BODY, 1.35);
    const cs = this.ctaSize();
    const copyH = hook.lines * hookSize * 1.25 + 2.4 * u + h1.lines * h1Size * 0.98 + 2.6 * u + subH + 4 * u + cs.h;
    const cy = land ? (H - copyH) / 2 : top;
    let y = cy;
    this.words(hook.words, pad, y, t, 0.4, 0.09, 0.4, hookSize, 700, BODY, 0.08, () => hsla(this.b.light, 0.9));
    y += hook.lines * hookSize * 1.25 + 2.4 * u;
    this.words(h1.words, pad, y, t, 1.15, 0.14, 0.55, h1Size, 800, DISPLAY, -0.035, (w) => ((w.i + 1) % 3 === 0 ? this.accent : "#fff"));
    y += h1.lines * h1Size * 0.98 + 2.6 * u;
    y += this.block(c.sub, pad, y, subW, subSize, 400, BODY, 1.35, 0.82, seg(t, 2.5, 0.6)) + 4 * u;
    const cw = this.cta(t, pad, y, 5.4);
    this.domain(t, pad + cw.w + 3 * u, y + cs.h / 2, 5.9);
    // browser
    const q = seg(t, 2.9, 1.4, outExpo);
    if (q > 0) {
      const bw = land ? W - pad - (W * 0.52) : W - pad * 2;
      const bx = land ? W * 0.52 : pad;
      const vh = (portrait ? 78 : land ? 52 : 46) * u;
      const by = land ? (H - vh - 4 * u) / 2 : cy + copyH + 4 * u;
      x.save();
      x.globalAlpha = q;
      const s = 0.92 + 0.08 * q;
      x.translate(bx + bw / 2, by + (1 - q) * 30 * u);
      x.scale(s, s * (0.88 + 0.12 * q));
      x.translate(-(bx + bw / 2), -by);
      this.browser(bx, by, bw, vh, a.full || a.desktop, 0.38 * seg(t, 3.6, 4.2, inOut) * (a.full ? 1 : 0.4));
      x.restore();
    }
  }

  tour(t: number) {
    const { x, u, W, H, land, portrait, c, a } = this;
    const h1Size = (portrait ? 8.6 : land ? 6.4 : 7) * u;
    const maxW = Math.min(W - 12 * u, h1Size * (land ? 13 : 8.5));
    font(x, 800, h1Size, DISPLAY, -0.035);
    const h1 = layoutWords(x, c.headline, maxW, h1Size * 0.98, "center");
    const h1H = h1.lines * h1Size * 0.98;
    const fw = W * (land ? 0.62 : portrait ? 0.92 : 0.84);
    const vh = (portrait ? 82 : land ? 54 : 50) * u;
    const frameH = vh + 4 * u;
    const cs = this.ctaSize();
    const top = (portrait ? 16 : 12) * u;
    const total = h1H + 4 * u + frameH + 4 * u + cs.h;
    const y0 = Math.max(top, (H - total) / 2 + top / 3);
    const q1 = seg(t, 0.4, 0.7);
    if (q1 > 0) {
      const last = h1.words.length - 1;
      x.save();
      x.globalAlpha = q1;
      font(x, 800, h1Size, DISPLAY, -0.035);
      x.textBaseline = "top";
      for (const w of h1.words) {
        x.fillStyle = w.i === last ? this.accent : "#fff";
        x.fillText(w.text, (W - maxW) / 2 + w.x, y0 + w.y + (1 - q1) * 6 * u);
      }
      x.restore();
    }
    const fx = (W - fw) / 2;
    const fy = y0 + h1H + 4 * u;
    const q2 = seg(t, 0.9, 1.1, outExpo);
    if (q2 > 0) {
      x.save();
      x.globalAlpha = q2;
      const s = 0.94 + 0.06 * q2;
      x.translate(W / 2, fy + (1 - q2) * 16 * u);
      x.scale(s, s);
      x.translate(-W / 2, -fy);
      const st = clamp((t - 1.6) / 5.6);
      const sc = st < 0.45 ? 0.22 * inOut(st / 0.45) : 0.22 + 0.33 * inOut((st - 0.45) / 0.55);
      this.browser(fx, fy, fw, vh, a.full || a.desktop, sc * (a.full ? 1 : 0.35));
      x.restore();
    }
    // chips
    const chipSize = (portrait ? 3 : 2.5) * u;
    const pos = [
      { l: true, off: land ? -0.14 : -0.03, y: 0.14 },
      { l: false, off: land ? -0.14 : -0.03, y: 0.42 },
      { l: true, off: land ? -0.1 : -0.02, y: 0.78 },
    ];
    (c.benefits || []).slice(0, 3).forEach((txt, i) => {
      const q = seg(t, 2.2 + i * 1.1, 0.55, outBack);
      if (q <= 0) return;
      font(x, 700, chipSize);
      const maxCW = chipSize * (land ? 17 : 11);
      const L = layoutWords(x, txt, maxCW, chipSize * 1.2);
      const dot = 3.4 * u;
      const cw = L.width + dot + 1.4 * u + 5.2 * u;
      const ch = Math.max(L.lines * chipSize * 1.2, dot) + 3.6 * u;
      const p = pos[i];
      const cx = p.l ? fx + p.off * fw : fx + fw - p.off * fw - cw;
      const cy = fy + 4 * u + p.y * vh;
      x.save();
      x.globalAlpha = clamp(q * 1.5);
      x.translate(cx + cw / 2, cy + ch / 2);
      const s = 0.6 + 0.4 * q;
      x.scale(s, s);
      x.translate(-cw / 2, -ch / 2);
      x.shadowColor = "rgba(0,0,0,.4)";
      x.shadowBlur = 6 * u;
      x.shadowOffsetY = 2 * u;
      x.fillStyle = "rgba(255,255,255,.96)";
      rr(x, 0, 0, cw, ch, 2 * u);
      x.fill();
      x.shadowColor = "transparent";
      x.fillStyle = this.b.primary;
      x.beginPath();
      x.arc(2.6 * u + dot / 2, ch / 2, dot / 2, 0, Math.PI * 2);
      x.fill();
      x.save();
      x.translate(2.6 * u + dot / 2 - dot * 0.32, ch / 2 - dot * 0.32);
      x.scale((dot * 0.64) / 24, (dot * 0.64) / 24);
      x.strokeStyle = "#fff";
      x.lineWidth = 3.2;
      x.lineCap = "round";
      x.stroke(CHECK);
      x.restore();
      x.fillStyle = "#111";
      x.textBaseline = "top";
      font(x, 700, chipSize);
      for (const w of L.words) x.fillText(w.text, 2.6 * u + dot + 1.4 * u + w.x, (ch - L.lines * chipSize * 1.2) / 2 + w.y + chipSize * 0.05);
      x.restore();
    });
    // CTA row (centered)
    font(x, 500, 2.6 * u, BODY, 0.02);
    const dw = x.measureText(this.b.domain).width;
    const rowW = cs.w + 3 * u + dw;
    const ry = fy + frameH + 4 * u;
    const rx = (W - rowW) / 2;
    this.cta(t, rx, ry, 5.8);
    this.domain(t, rx + cs.w + 3 * u, ry + cs.h / 2, 6.2);
  }

  problem(t: number) {
    const { x, u, W, H, land, portrait, c, a } = this;
    const pad = (land ? 10 : 7) * u;
    // scene 1
    const out1 = seg(t, 2.7, 0.5);
    if (t < 3.3) {
      const painSize = (portrait ? 9.6 : 8) * u;
      font(x, 800, painSize, DISPLAY, -0.035);
      const maxW = W - pad * 2;
      const L = layoutWords(x, c.pain || c.hook, maxW, painSize * 1.02);
      const kSize = 3 * u;
      const blockH = kSize * 1.3 + 3 * u + L.lines * painSize * 1.02;
      const y0 = (H - blockH) / 2 - out1 * 6 * u;
      x.save();
      x.globalAlpha = 1 - out1;
      x.save();
      x.globalAlpha *= 0.65 * seg(t, 0.2, 0.4);
      font(x, 700, kSize, BODY, 0.12);
      x.fillStyle = "#fff";
      x.textBaseline = "top";
      x.fillText(String(c.hook || "").toUpperCase(), pad, y0);
      x.restore();
      const py = y0 + kSize * 1.3 + 3 * u;
      const q = seg(t, 0.3, 0.7);
      x.save();
      x.globalAlpha *= q;
      font(x, 800, painSize, DISPLAY, -0.035);
      x.fillStyle = "#fff";
      x.textBaseline = "top";
      for (const w of L.words) x.fillText(w.text, pad + w.x, py + w.y + (1 - q) * 6 * u);
      x.restore();
      // strike each line
      const sq = seg(t, 1.9, 0.6, inOut);
      if (sq > 0) {
        x.save();
        x.fillStyle = this.b.primary;
        x.shadowColor = this.b.primary;
        x.shadowBlur = 3 * u;
        let acc = 0;
        const total = L.lineWidths.reduce((s, v) => s + v * 1.04, 0);
        L.lineWidths.forEach((lw, li) => {
          const len = Math.max(0, Math.min(lw * 1.04, sq * total - acc));
          acc += lw * 1.04;
          if (len <= 0) return;
          rr(x, pad - lw * 0.02, py + li * painSize * 1.02 + painSize * 0.5, len, 1.2 * u, 0.6 * u);
          x.fill();
        });
        x.restore();
      }
      x.restore();
    }
    // mini phone
    const shot = a.mobile || a.desktop;
    if (shot) {
      const mw = W * (land ? 0.3 : 0.44);
      const mh = Math.min((shot.height / shot.width) * mw, mw * 2.1);
      let alpha = 0,
        ty = 0;
      if (land) {
        const q = seg(t, 3.6, 1, outExpo);
        alpha = 0.95 * q;
        ty = (1 - q) * 0.3 * mh;
      } else {
        const q = seg(t, 0.7, 1, outExpo);
        alpha = 0.95 * q * (1 - seg(t, 2.6, 0.5));
        ty = (1 - q) * 0.3 * mh;
      }
      if (alpha > 0) {
        x.save();
        x.globalAlpha = alpha;
        const X = W + 6 * u - mw;
        const Y = H + 8 * u - mh * 0.85 + ty;
        x.translate(X + mw / 2, Y + mh / 2);
        x.rotate((-8 * Math.PI) / 180);
        x.translate(-mw / 2, -mh / 2);
        x.shadowColor = "rgba(0,0,0,.6)";
        x.shadowBlur = 10 * u;
        x.shadowOffsetY = 3 * u;
        x.fillStyle = "#0b0b0f";
        rr(x, -0.8 * u, -0.8 * u, mw + 1.6 * u, mh + 1.6 * u, 3.6 * u);
        x.fill();
        x.shadowColor = "transparent";
        rr(x, 0, 0, mw, mh, 3 * u);
        x.clip();
        x.drawImage(shot, 0, 0, mw, (shot.height / shot.width) * mw);
        x.restore();
      }
    }
    // scene 2
    if (t >= 2.9) {
      const right = land ? W * 0.66 : W - pad;
      const maxW = right - pad;
      const meetS = 3.4 * u;
      const h1Size = (portrait ? 9.2 : 7.4) * u;
      font(x, 800, h1Size, DISPLAY, -0.035);
      const h1 = layoutWords(x, c.headline, Math.min(maxW, h1Size * 9.5), h1Size * 0.98);
      const cardS = (portrait ? 3.5 : 2.9) * u;
      const ben = (c.benefits || []).slice(0, 3);
      const cols = land ? 3 : 1;
      const gap = 2 * u;
      const cardW = (maxW - gap * (cols - 1)) / cols;
      const box = 4.2 * u;
      const cardTextW = cardW - box - 1.8 * u - 6 * u;
      const cardHs = ben.map((b) => Math.max(this.measureBlock(b, cardTextW, cardS, 600, BODY, 1.25), box) + 4.8 * u);
      const cardsH = land ? Math.max(...cardHs, 0) : cardHs.reduce((s, h) => s + h + gap, -gap);
      const cs = this.ctaSize();
      const total = meetS * 1.3 + 3 * u + h1.lines * h1Size * 0.98 + 3 * u + 1.5 * u + cardsH + 2.5 * u + 3 * u + cs.h;
      let y = (H - total) / 2;
      this.block(`Meet ${this.b.name}`, pad, y, maxW, meetS, 700, BODY, 1.3, 0.75, seg(t, 3, 0.5));
      y += meetS * 1.3 + 3 * u;
      const q = seg(t, 3.2, 0.6);
      if (q > 0) {
        const last = h1.words.length - 1;
        x.save();
        x.globalAlpha = q;
        font(x, 800, h1Size, DISPLAY, -0.035);
        x.textBaseline = "top";
        for (const w of h1.words) {
          x.fillStyle = w.i === last ? this.accent : "#fff";
          x.fillText(w.text, pad + w.x, y + w.y + (1 - q) * 6 * u);
        }
        x.restore();
      }
      y += h1.lines * h1Size * 0.98 + 4.5 * u;
      let cy = y;
      ben.forEach((b, i) => {
        const cq = seg(t, 3.9 + i * 0.45, 0.55);
        const cx = land ? pad + i * (cardW + gap) : pad;
        const ch = land ? cardsH : cardHs[i];
        if (cq > 0) {
          x.save();
          x.globalAlpha = cq;
          const oy = (1 - cq) * 6 * u;
          x.fillStyle = "rgba(255,255,255,.07)";
          rr(x, cx, cy + oy, cardW, ch, 2.2 * u);
          x.fill();
          x.strokeStyle = "rgba(255,255,255,.14)";
          x.lineWidth = 1.5;
          x.stroke();
          x.fillStyle = this.b.primary;
          rr(x, cx + 3 * u, cy + oy + (ch - box) / 2, box, box, 1.2 * u);
          x.fill();
          font(x, 700, 2.2 * u);
          x.fillStyle = "#fff";
          x.textAlign = "center";
          x.textBaseline = "middle";
          x.fillText(String(i + 1), cx + 3 * u + box / 2, cy + oy + ch / 2 + 1);
          x.textAlign = "left";
          const th = this.measureBlock(b, cardTextW, cardS, 600, BODY, 1.25);
          this.block(b, cx + 3 * u + box + 1.8 * u, cy + oy + (ch - th) / 2, cardTextW, cardS, 600, BODY, 1.25, 1, 1);
          x.restore();
        }
        if (!land) cy += ch + gap;
      });
      y += cardsH + 5.5 * u;
      const cw = this.cta(t, pad, y, 5.7);
      this.domain(t, pad + cw.w + 3 * u, y + cs.h / 2, 6.1);
    }
  }

  spotlight(t: number) {
    const { x, u, W, H, land, portrait, c, a, b } = this;
    // Ken Burns blurred background
    if (a.blurBg) {
      const s = 1.04 + 0.12 * (t / DURATION);
      x.save();
      x.translate(W / 2, H / 2);
      x.scale(s, s);
      x.translate(-W / 2 - 0.015 * W * (t / DURATION), -H / 2 - 0.01 * H * (t / DURATION));
      x.drawImage(a.blurBg, 0, 0, W, H);
      x.restore();
    } else this.bg(t);
    const g = land ? x.createLinearGradient(0, 0, W, 0) : x.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, hsla(b.dark, 0.96));
    g.addColorStop(land ? 0.32 : 0.3, hsla(b.dark, 0.96));
    g.addColorStop(land ? 0.75 : 0.7, hsla(b.dark, 0.3));
    g.addColorStop(1, hsla(b.dark, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    const pad = (land ? 9 : 7) * u;
    const maxW = land ? W * 0.58 - pad : W - pad * 2;
    const h1Size = (portrait ? 10 : land ? 7.8 : 8.6) * u;
    const lines = splitLines(c.headline);
    const subS = (portrait ? 3.6 : 3) * u;
    const subW = Math.min(maxW, subS * 16);
    const subH = this.measureBlock(c.sub, subW, subS, 400, BODY, 1.35);
    const cs = this.ctaSize();
    const tagS = 2.4 * u;
    const tagH = tagS + 2 * u;
    const total = tagH + 2.6 * u + lines.length * h1Size * 0.98 + 2.6 * u + subH + 4 * u + cs.h;
    let y = land ? (H - total) / 2 : H - pad - total;
    // tag
    const tq = seg(t, 0.6, 0.5, outBack);
    if (tq > 0) {
      font(x, 700, tagS, BODY, 0.08);
      const txt = String(c.hook || "").toUpperCase().slice(0, 40);
      const tw = x.measureText(txt).width + 4.4 * u;
      x.save();
      x.globalAlpha = clamp(tq * 1.5);
      x.translate(pad + tw / 2, y + tagH / 2);
      x.scale(0.6 + 0.4 * tq, 0.6 + 0.4 * tq);
      x.fillStyle = hsla(b.primary, 0.85);
      rr(x, -tw / 2, -tagH / 2, tw, tagH, tagH / 2);
      x.fill();
      x.fillStyle = "#fff";
      x.textBaseline = "middle";
      x.fillText(txt, -tw / 2 + 2.2 * u, 1);
      x.restore();
    }
    y += tagH + 2.6 * u;
    font(x, 800, h1Size, DISPLAY, -0.035);
    lines.forEach((ln, i) => {
      const q = seg(t, 1 + i * 0.22, 0.8, outExpo);
      if (q <= 0) return;
      const lh = h1Size * 0.98;
      x.save();
      x.beginPath();
      x.rect(0, y + i * lh - 0.1 * h1Size, W, lh + 0.2 * h1Size);
      x.clip();
      x.fillStyle = "#fff";
      x.textBaseline = "top";
      x.fillText(ln, pad, y + i * lh + (1 - q) * 1.05 * lh);
      x.restore();
    });
    y += lines.length * h1Size * 0.98 + 2.6 * u;
    y += this.block(c.sub, pad, y, subW, subS, 400, BODY, 1.35, 0.86, seg(t, 2.4, 0.6)) + 4 * u;
    const cw = this.cta(t, pad, y, 4.6);
    this.domain(t, pad + cw.w + 3 * u, y + cs.h / 2, 5.1);
  }

  draw(t: number) {
    const { x, W, H } = this;
    x.save();
    x.clearRect(0, 0, W, H);
    if (this.tpl !== "spotlight") this.bg(t);
    this[this.tpl](t);
    this.grain();
    this.logo(t);
    x.restore();
  }
}

function splitLines(s: string) {
  const w = String(s || "").split(/\s+/);
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

function blurred(im: HTMLImageElement, W: number, H: number) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  const s = Math.max(W / im.width, H / im.height);
  const w = im.width * s,
    h = im.height * s;
  try {
    x.filter = "blur(22px) brightness(.55) saturate(1.3)";
  } catch {}
  x.drawImage(im, (W - w) / 2 - 40, (H - h) / 2 - 40, w + 80, h + 80);
  x.filter = "none";
  if (!("filter" in (x as any))) {
    x.fillStyle = "rgba(0,0,0,.45)";
    x.fillRect(0, 0, W, H);
  }
  return c;
}

async function encodeWebCodecs(scene: Scene, canvas: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<Blob | null> {
  const VE = (window as any).VideoEncoder;
  const VF = (window as any).VideoFrame;
  if (!VE || !VF) return null;
  const { W, H } = scene;
  let codec = "";
  for (const c of ["avc1.640028", "avc1.4d0028", "avc1.42002a", "avc1.640033"]) {
    try {
      const s = await VE.isConfigSupported({ codec: c, width: W, height: H, bitrate: 8_000_000, framerate: FPS });
      if (s.supported) {
        codec = c;
        break;
      }
    } catch {}
  }
  if (!codec) return null;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: FPS }, fastStart: "in-memory" });
  let err: any = null;
  const enc = new VE({ output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta), error: (e: any) => (err = e) });
  enc.configure({ codec, width: W, height: H, bitrate: 8_000_000, framerate: FPS, avc: { format: "avc" } });
  const total = DURATION * FPS;
  for (let i = 0; i < total; i++) {
    if (err) throw err;
    scene.draw(i / FPS);
    const vf = new VF(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(vf, { keyFrame: i % 60 === 0 });
    vf.close();
    while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (i % 10 === 0) {
      onProgress?.(i / total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
  muxer.finalize();
  return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: "video/mp4" });
}

async function encodeRecorder(scene: Scene, canvas: HTMLCanvasElement): Promise<Blob> {
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  const mime = types.find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t)) || "video/webm";
  const stream = (canvas as any).captureStream(FPS);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((res) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      scene.draw(Math.min(t, DURATION));
      if (t < DURATION) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  return new Blob(parts, { type: mime.split(";")[0] });
}

export async function renderAdLocal(tpl: TemplateKey, fmt: FormatKey, brand: AdBrand, copy: AdCopy, base: string, onProgress?: (p: number) => void) {
  await ensureFonts();
  const { w: W, h: H } = FORMATS[fmt];
  const [logo, desktop, mobile, full] = await Promise.all([img(brand.logo), img(brand.desktop), img(brand.mobile), img(brand.full)]);
  const assets: Assets = { logo, desktop, mobile, full, grain: makeGrain() };
  if (tpl === "spotlight" && desktop) assets.blurBg = blurred(desktop, W, H);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const scene = new Scene(ctx, fmt, tpl, brand, { ...copy, benefits: (copy.benefits || []).slice(0, 3) }, assets);
  let video = await encodeWebCodecs(scene, canvas, onProgress).catch((e) => {
    console.warn("WebCodecs encode failed, falling back", e);
    return null;
  });
  if (!video) video = await encodeRecorder(scene, canvas);
  scene.draw(7.6);
  const poster: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.9));
  const ext = video.type.includes("mp4") ? "mp4" : "webm";
  const vName = await putMedia(`${base}.${ext}`, video);
  const pName = await putMedia(`${base}.jpg`, poster);
  return { video: vName, poster: pName };
}
