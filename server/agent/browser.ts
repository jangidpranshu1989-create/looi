import { chromium, type Browser } from "playwright-core";
import fs from "node:fs";

export function chromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Chromium not found. Set CHROME_PATH.");
}

let browserP: Promise<Browser> | null = null;
export async function getBrowser(): Promise<Browser> {
  if (browserP) {
    const b = await browserP.catch(() => null);
    if (b && b.isConnected()) return b;
  }
  browserP = chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
  });
  return browserP;
}

/** Simple global mutex so heavy jobs (lighthouse / rendering) don't fight over 2 CPUs */
let chain: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}
