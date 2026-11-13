import { chromium } from "/home/user/workspace/looi/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
const dir = process.argv[2];
const b = await chromium.launch({ executablePath: "/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome", args:["--no-sandbox"] });
const p = await b.newPage();
async function r(svgFile, size, out, bg) {
  const svg = fs.readFileSync(`${dir}/${svgFile}`, "utf8");
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:${bg || "transparent"}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center">${svg.replace("<svg ", `<svg width="${bg ? Math.round(size * 0.48) : size}" height="${bg ? Math.round(size * 0.48) : size}" `)}</div></body></html>`);
  await p.screenshot({ path: `${dir}/${out}`, omitBackground: !bg });
}
for (const [n, a, f] of [["mdpi", 48, 108], ["hdpi", 72, 162], ["xhdpi", 96, 216], ["xxhdpi", 144, 324], ["xxxhdpi", 192, 432]]) {
  await r("full.svg", a, `mipmap-${n}/ic_launcher.png`);
  await r("round.svg", a, `mipmap-${n}/ic_launcher_round.png`);
  await r("fg.svg", f, `mipmap-${n}/ic_launcher_foreground.png`);
}
await r("fg.svg", 1080, "splash.png", "#0b0b0d");
await b.close();
