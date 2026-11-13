// Restores the SQLite database and recent media from R2 before the server boots (Cloudflare Containers).
// No-op when LOOI_R2_URL is unset.
import fs from "node:fs";
import path from "node:path";

const R2 = (process.env.LOOI_R2_URL || "").replace(/\/$/, "");
if (!R2) process.exit(0);
const headers = { "x-looi-r2": process.env.LOOI_R2_TOKEN || "" };
const DB = process.env.LOOI_DB || "data.db";
const MEDIA = path.join(process.env.LOOI_DATA_DIR || "looi-data", "media");
const budget = (Number(process.env.LOOI_RESTORE_MEDIA_MB) || 1500) * 1024 * 1024;
fs.mkdirSync(MEDIA, { recursive: true });
fs.mkdirSync(path.dirname(path.resolve(DB)), { recursive: true });

async function get(key) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`${R2}/${key}`, { headers, signal: AbortSignal.timeout(120_000) });
      if (r.status === 404) return null;
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`R2 unreachable for ${key}`);
}

const t0 = Date.now();
const db = await get("db/data.db");
if (db) {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB + s, { force: true });
  fs.writeFileSync(DB, db);
  console.log(`[restore] database ${(db.length / 1e6).toFixed(1)} MB`);
} else console.log("[restore] no backup yet, starting fresh");

// newest media first, up to the budget; older files are pulled lazily on request
const list = await get("_list?prefix=media/");
let used = 0, n = 0;
if (list) {
  const items = JSON.parse(list.toString()).sort((a, b) => b.uploaded - a.uploaded);
  const queue = items.filter((o) => (used += o.size) <= budget);
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const o = queue.shift();
      const f = path.join(MEDIA, path.basename(o.key));
      if (fs.existsSync(f)) continue;
      const b = await get(o.key).catch(() => null);
      if (b) (fs.writeFileSync(f, b), n++);
    }
  });
  await Promise.all(workers);
}
console.log(`[restore] ${n} media files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
