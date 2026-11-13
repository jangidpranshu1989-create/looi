/** Boots the on-device engine and bridges it to the OS: background runner sync, notifications, downloads. */
import { db, dbHooks, initDb, flush, type Row } from "./db";
import { initMedia, getMedia, getMediaUrl } from "./media";
import { blobToB64 } from "./media";
import { isNative } from "./net";
import * as A from "./agent";
import { refreshPendingPlugins } from "./router";

const P = () => (window as any).Capacitor?.Plugins || {};
const LABEL = "app.looi.agent.check";

async function dispatch(event: string, details: any = {}) {
  const BR = P().BackgroundRunner;
  if (!isNative() || !BR) return null;
  try {
    return await BR.dispatchEvent({ label: LABEL, event, details });
  } catch (e) {
    console.warn("runner", event, e);
    return null;
  }
}

/** Slim snapshot the background runner needs to run a cycle without the app. */
function slimState() {
  const st = A.getSettings();
  return {
    settings: st,
    missions: db.all("missions").map((m) => {
      const creatives = db.where("creatives", (c) => c.missionId === m.id);
      const posts = db.where("posts", (p) => p.missionId === m.id && p.status === "published");
      const site = m.site || {};
      return {
        id: m.id,
        name: m.name,
        url: m.url,
        status: m.status === "running" ? "active" : m.status,
        mode: m.mode,
        channelIds: m.channelIds || [],
        cycle: m.cycle || 0,
        nextCheckAt: m.nextCheckAt || 0,
        product: m.brief?.product || null,
        topIssues: (m.report?.ai?.issues || []).slice(0, 5).map((i: any) => i.title),
        recent: db.where("snapshots", (s) => s.missionId === m.id).slice(-3).map((s) => s.data),
        perCreative: creatives.slice(-16).map((c) => ({ id: c.id, cycle: c.cycle, angle: c.angle, template: c.template, format: c.format, headline: c.copy?.headline, status: c.status, posts: posts.filter((p) => p.creativeId === c.id).length })),
        usedPlaybooks: db.where("playbooks", (p) => p.missionId === m.id).map((p) => p.channel),
        lsScores: (() => {
          const s = m.report?.lighthouse?.mobile?.scores;
          return s ? { accessibility: s.accessibility, bestPractices: s.bestPractices, seo: s.seo } : null;
        })(),
        healthSite: { https: site.https, securityHeaders: site.securityHeaders },
      };
    }),
    channels: db.all("channels").map((c) => ({ id: c.id, name: c.name, type: c.type, status: c.status, config: c.config })),
  };
}

let syncT: any;
function scheduleSync() {
  clearTimeout(syncT);
  syncT = setTimeout(() => void dispatch("sync", { state: JSON.stringify(slimState()) }), 1500);
}

/** Merge what the background runner did while the app was closed. */
export async function pullOutbox() {
  const r: any = await dispatch("pull");
  if (!r) return 0;
  let ops: any[] = [];
  try {
    ops = typeof r.ops === "string" ? JSON.parse(r.ops) : r.ops || [];
  } catch {}
  for (const o of ops) {
    const { op, ...v } = o;
    if (!db.get("missions", v.missionId ?? v.id)) continue;
    if (op === "event") db.insert("events", v);
    else if (op === "notify") db.insert("notifications", { ...v, approvalId: 0, read: false });
    else if (op === "playbook") db.insert("playbooks", v);
    else if (op === "snapshot") db.insert("snapshots", v);
    else if (op === "mission") db.update("missions", v.id, v.patch);
    else if (op === "creative") {
      const { posts, ...c } = v;
      const cr = db.insert("creatives", { ...c, posterFile: "", videoFile: "", status: "needs-render" });
      for (const p of posts || []) db.insert("posts", { ...p, missionId: c.missionId, creativeId: cr.id, metrics: {} });
    }
  }
  if (ops.length) A.renderPending();
  return ops.length;
}

/** Download / share a locally stored ad. Web: blob download. Native: save to cache + share sheet. */
export async function saveMedia(file: string) {
  const blob = await getMedia(file);
  if (!blob) return;
  const { Filesystem, Share } = P();
  if (isNative() && Filesystem) {
    const w = await Filesystem.writeFile({ path: file, data: await blobToB64(blob), directory: "CACHE" });
    if (Share) await Share.share({ title: "Looi ad", files: [w.uri], url: w.uri, dialogTitle: "Share or save your ad" }).catch(() => {});
    return;
  }
  const a = document.createElement("a");
  a.href = getMediaUrl(file);
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function interceptLinks() {
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as HTMLElement)?.closest?.("a") as HTMLAnchorElement | null;
      const href = a?.getAttribute("href") || "";
      if (href.startsWith("looi-media:")) {
        e.preventDefault();
        void saveMedia(href.slice("looi-media:".length));
      } else if (href.startsWith("blob:") && isNative()) {
        e.preventDefault(); // WebView can't open blob: in a new window — screenshots are viewable inline
      }
    },
    true,
  );
}

let booted = false;
export async function bootDevice() {
  if (booted) return;
  booted = true;
  await initDb();
  await initMedia();
  A.getSettings();
  let pending = false;
  dbHooks.onChange = () => {
    if (!pending) {
      pending = true;
      setTimeout(() => ((pending = false), scheduleSync()), 0);
    }
  };
  A.setStateListener(scheduleSync);
  // Background-made creatives: after render, mark published ones instead of asking again.
  interceptLinks();
  await pullOutbox();
  A.startScheduler();
  scheduleSync();
  void refreshPendingPlugins();

  const { App, LocalNotifications } = P();
  App?.addListener?.("appStateChange", async (s: { isActive: boolean }) => {
    if (s.isActive) {
      await pullOutbox();
      void refreshPendingPlugins();
    } else {
      flush();
      void dispatch("sync", { state: JSON.stringify(slimState()) });
    }
  });
  LocalNotifications?.addListener?.("localNotificationActionPerformed", (ev: any) => {
    const x = ev?.notification?.extra || {};
    if (x.approvalId) location.hash = "#/app/approvals";
    else if (x.missionId) location.hash = `#/app/m/${x.missionId}`;
  });
  window.addEventListener("pagehide", () => flush());
  import("./router").then((r) => ((window as any).__looiDevice = { localFetch: r.localFetch, db, pullOutbox }));
}

export type { Row };
