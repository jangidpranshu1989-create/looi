// Copies the built Looi client into native/www and injects the native boot script.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.resolve(root, "../dist/public");
const out = path.resolve(root, "www");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.copyFileSync(path.join(root, "setup/boot.js"), path.join(out, "boot.js"));
let html = fs.readFileSync(path.join(out, "index.html"), "utf8");
const m = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
if (!m) throw new Error("bundle script not found");
html = html.replace(m[0], `<script>window.__LOOI_ENTRY__=${JSON.stringify(m[1])}</script><script src="./boot.js"></script>`);
fs.writeFileSync(path.join(out, "index.html"), html);
console.log("www ready →", out);
