/**
 * Durable storage for ephemeral hosts (Cloudflare Containers).
 *
 * When LOOI_R2_URL is set (the Worker exposes an R2 bucket at a virtual host such as http://r2.looi),
 * the SQLite database is snapshotted to R2 every minute when it changed and on shutdown, and every new
 * media file (screenshots, MP4 ads, posters) is uploaded. script/r2-restore.mjs brings it all back on boot.
 */
import fs from "node:fs";
import path from "node:path";
import { sqlite, DATA_DIR } from "./storage";

const R2 = (process.env.LOOI_R2_URL || "").replace(/\/$/, "");
const KEY = process.env.LOOI_R2_TOKEN || "";
export const persistEnabled = () => !!R2;
const MEDIA = path.join(DATA_DIR, "media");
const headers = () => ({ "x-looi-r2": KEY });

async function put(key: string, file: string) {
  const body = fs.readFileSync(file);
  const r = await fetch(`${R2}/${key}`, { method: "PUT", headers: headers(), body, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`R2 PUT ${key} → ${r.status}`);
}

let lastChanges = -1;
let backingUp: Promise<void> | null = null;
function changes() {
  return (sqlite.prepare("SELECT total_changes() n").get() as any).n as number;
}
export async function backupDb(force = false) {
  if (!R2) return;
  if (backingUp) return backingUp;
  const n = changes();
  if (!force && n === lastChanges) return;
  backingUp = (async () => {
    const tmp = path.join(DATA_DIR, `.backup-${Date.now()}.db`);
    try {
      await sqlite.backup(tmp);
      await put("db/data.db", tmp);
      const day = new Date().toISOString().slice(0, 10);
      if (lastDaily !== day) {
        await put(`db/daily/${day}.db`, tmp);
        lastDaily = day;
      }
      lastChanges = n;
    } catch (e) {
      console.error("[persist] db backup failed:", (e as Error).message);
    } finally {
      fs.rmSync(tmp, { force: true });
      backingUp = null;
    }
  })();
  return backingUp;
}
let lastDaily = "";

const uploaded = new Set<string>();
let scanFrom = Date.now() - 60_000;
export async function syncMedia() {
  if (!R2 || !fs.existsSync(MEDIA)) return;
  const started = Date.now();
  for (const f of fs.readdirSync(MEDIA)) {
    if (uploaded.has(f) || f.startsWith(".")) continue;
    const p = path.join(MEDIA, f);
    const st = fs.statSync(p);
    if (!st.isFile() || st.mtimeMs < scanFrom) continue;
    if (Date.now() - st.mtimeMs < 5_000) continue; // still being written
    try {
      await put(`media/${f}`, p);
      uploaded.add(f);
    } catch (e) {
      console.error("[persist] media upload failed:", f, (e as Error).message);
    }
  }
  scanFrom = started - 10_000;
}

/** Fetch a media file back from R2 if it isn't on local disk (after a restart). */
export async function ensureMedia(name: string): Promise<boolean> {
  const p = path.join(MEDIA, path.basename(name));
  if (fs.existsSync(p)) return true;
  if (!R2) return false;
  try {
    const r = await fetch(`${R2}/media/${encodeURIComponent(path.basename(name))}`, { headers: headers(), signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return false;
    fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
    uploaded.add(path.basename(name));
    return true;
  } catch {
    return false;
  }
}

export function startPersistence() {
  if (!R2) return;
  // files restored on boot are already in R2
  if (fs.existsSync(MEDIA)) for (const f of fs.readdirSync(MEDIA)) uploaded.add(f);
  lastChanges = changes();
  const every = Math.max(15, Number(process.env.LOOI_BACKUP_SEC) || 60) * 1000;
  setInterval(() => void syncMedia().then(() => backupDb()), every).unref();
  let stopping = false;
  const flush = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[persist] ${sig}: flushing to R2`);
    await syncMedia().catch(() => {});
    await backupDb(true).catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void flush("SIGTERM"));
  process.on("SIGINT", () => void flush("SIGINT"));
  console.log(`[persist] R2 persistence on (${R2})`);
}
