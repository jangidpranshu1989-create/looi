// Copies the built Looi client into native/www and injects the native boot script.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.resolve(root, "../dist/public");
const out = path.resolve(root, "www");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.writeFileSync(path.join(out, "boot.js"), fs.readFileSync(path.join(root, "setup/boot.js"), "utf8").replace("__LOOI_CLOUD_URL__", (process.env.LOOI_CLOUD_URL || "__LOOI_CLOUD_URL__").replace(/\/$/, "")));
// Bundle the on-device background agent (shares core/ with the app).
import { execSync } from "node:child_process";
execSync(`${path.resolve(root, "../node_modules/.bin/esbuild")} ${path.join(root, "runner-src/runner.ts")} --bundle --format=iife --target=es2019 --outfile=${path.join(root, "runners/looi-runner.js")}`, { stdio: "inherit", cwd: path.resolve(root, "..") });
// BackgroundRunner loads its script relative to webDir
fs.cpSync(path.join(root, "runners"), path.join(out, "runners"), { recursive: true });
let html = fs.readFileSync(path.join(out, "index.html"), "utf8");
const m = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
if (!m) throw new Error("bundle script not found");
html = html.replace(m[0], `<script>window.__LOOI_ENTRY__=${JSON.stringify(m[1])}</script><script src="./boot.js"></script>`);
fs.writeFileSync(path.join(out, "index.html"), html);
console.log("www ready →", out);
