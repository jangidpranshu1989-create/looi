/**
 * Looi background runner — executes in the OS background (Android WorkManager, ~15 min minimum)
 * even when the app is closed. Device mode: runs the agent's re-check loop on the phone itself
 * (site check → PageSpeed → AI strategist → caption+link publish via Composio → notification).
 * Results go to an outbox that the app merges on next open (and renders the video ads then).
 * Server mode (legacy): polls a Looi server's /api/live for notifications.
 */
import { fetchHttp, J, type HttpFn } from "../../client/src/local/core/http";
import { DEFAULT_SETTINGS, type Settings } from "../../client/src/local/core/types";
import { chatJson } from "../../client/src/local/core/llm";
import { publishComposio } from "../../client/src/local/core/composio";
import { strategistPrompt, captionFor, capKeyFor, randCode, computeHealth, psiUrl, TEMPLATES } from "../../client/src/local/core/marketing";

declare const CapacitorKV: { get(k: string): { value: string } | null | undefined; set(k: string, v: string): void; remove(k: string): void };
declare const CapacitorNotifications: { schedule(n: { id: number; title: string; body: string; extra?: any }[]): void };
declare const CapacitorApp: { getState(): { isActive: boolean } } | undefined;
declare function addEventListener(ev: string, fn: (resolve: (v?: any) => void, reject: (e: any) => void, args: any) => void): void;

const kvGet = (k: string) => {
  try {
    const r: any = CapacitorKV.get(k);
    return r && typeof r === "object" ? r.value : r;
  } catch {
    return undefined;
  }
};
const http: HttpFn = fetchHttp;
const now = () => Date.now();

function utm(url: string, missionId: number, code: string, source: string) {
  const [base, hash] = url.split("#");
  const q = `utm_source=${encodeURIComponent(source)}&utm_medium=social&utm_campaign=looi-${missionId}&utm_content=${code}`;
  return base + (base.includes("?") ? "&" : "?") + q + (hash ? "#" + hash : "");
}

interface Outbox {
  ops: any[];
}
function readOutbox(): Outbox {
  return J(kvGet("looi_outbox"), { ops: [] });
}
function push(op: any) {
  const o = readOutbox();
  o.ops.push(op);
  if (o.ops.length > 400) o.ops = o.ops.slice(-400);
  CapacitorKV.set("looi_outbox", JSON.stringify(o));
}
let noteId = 5000;
function notify(title: string, body: string, kind: string, missionId: number) {
  push({ op: "notify", title, body, kind, missionId, ts: now() });
  try {
    CapacitorNotifications.schedule([{ id: (noteId++ % 90000) + 5000 + Math.floor(Math.random() * 1000), title, body, extra: { missionId } }]);
  } catch {}
}
const event = (missionId: number, kind: string, title: string, detail = "") => push({ op: "event", missionId, kind, title, detail, ts: now() });

async function psiPerf(url: string, key: string) {
  try {
    const r = await http(psiUrl(url, "mobile", key, ["performance"]), { timeout: 90000 });
    if (!r.ok) return {};
    const lhr = J(r.text).lighthouseResult || {};
    return { perf: Math.round((lhr.categories?.performance?.score ?? 0) * 100), lcp: lhr.audits?.["largest-contentful-paint"]?.displayValue || "" };
  } catch {
    return {};
  }
}

async function checkOne(state: any, m: any) {
  const st: Settings = { ...DEFAULT_SETTINGS, ...state.settings };
  const cycle = (m.cycle || 0) + 1;
  event(m.id, "info", `Cycle ${cycle} started (background)`, "Running on this phone while the app is closed.");
  const r = await http(m.url, { headers: { "User-Agent": "Mozilla/5.0 LooiAgent/1.0" }, timeout: 25000 }).catch(() => ({ status: 0, ms: 0 }) as any);
  const up = r.status > 0 && r.status < 400;
  if (!up) notify(`Site issue · ${m.name}`, `Your site returned ${r.status ? "HTTP " + r.status : "no response"}. New ads paused until it's back.`, "error", m.id);
  const { perf, lcp } = (await psiPerf(m.url, st.psiKey)) as any;
  const connected = (state.channels || []).filter((c: any) => c.status === "connected").map((c: any) => (c.type === "composio" ? c.config.toolkit : c.type));
  const sp = strategistPrompt(st, { product: m.product, cycle, status: r.status, ttfbMs: r.ms, perf, lcp, recent: m.recent || [], perCreative: m.perCreative || [], connected, usedPlaybooks: m.usedPlaybooks || [], topIssues: m.topIssues || [] });
  const { data: plan, via } = await chatJson<any>(http, st, sp.sys, sp.user, { maxTokens: 5000, temperature: 0.8 });
  event(m.id, "decision", `Strategist: ${String(plan.decision || "iterate").toUpperCase()} — ${plan.nextAngle?.name || "new angle"}`, `${plan.assessment || ""}\n${plan.reasoning || ""}`);
  for (const pb of (plan.playbooks || []).slice(0, 2)) push({ op: "playbook", missionId: m.id, cycle, channel: pb.channel, title: pb.title, content: pb.content, status: "ready", createdAt: now() });

  const posts: any[] = [];
  if (up && plan.nextAngle) {
    const angle = plan.nextAngle;
    const tpl = (TEMPLATES as readonly string[]).includes(plan.template) ? plan.template : "kinetic";
    const fmt = ["square", "story", "landscape"].includes(plan.format) ? plan.format : "square";
    const channels = (state.channels || []).filter((c: any) => (m.channelIds || []).includes(c.id) && c.status === "connected" && c.type === "composio");
    if (m.mode === "autopilot" && channels.length) {
      event(m.id, "decision", "Autopilot: publishing from the background", "Caption + tracked link now; the video ad renders next time you open Looi.");
      for (const ch of channels) {
        const tk = ch.config.toolkit;
        const code = randCode();
        const link = utm(m.url, m.id, code, tk);
        try {
          const caption = captionFor(capKeyFor(tk), angle.captions || {}, link, angle.hashtags || []);
          const res = await publishComposio(http, st, state.settings.userId, ch.config, { caption, title: angle.headline || m.name, link, posterUrl: "", videoUrl: "" });
          posts.push({ channelId: ch.id, channelType: tk, linkCode: code, externalId: res.externalId, externalUrl: res.externalUrl, status: "published", error: "", publishedAt: now() });
          event(m.id, "success", `Published to ${ch.name}`, `“${angle.headline}” · caption + tracked link`);
        } catch (e) {
          const msg = String((e as Error).message).slice(0, 400);
          posts.push({ channelId: ch.id, channelType: tk, linkCode: code, externalId: "", externalUrl: "", status: "failed", error: msg, publishedAt: 0 });
          event(m.id, "error", `Publish to ${ch.name} failed`, msg);
        }
      }
    }
    push({ op: "creative", missionId: m.id, cycle, angle: angle.name || "", template: tpl, format: fmt, copy: { ...angle, _reason: plan.reasoning || "", _published: posts.some((p) => p.status === "published") }, posts, createdAt: now() });
  }
  const health = computeHealth({ ...(m.healthSite || {}), ttfbMs: r.ms }, perf !== undefined ? { scores: { performance: perf, ...(m.lsScores || { accessibility: 70, bestPractices: 70, seo: 70 }) } } : undefined);
  push({ op: "snapshot", missionId: m.id, cycle, ts: now(), data: { health, perf, ttfb: r.ms, clicks: 0, decision: plan.decision, background: true } });
  const nextCheckAt = now() + (st.intervalMinutes || 150) * 60000;
  push({ op: "mission", id: m.id, patch: { cycle, lastCheckAt: now(), nextCheckAt, healthScore: health, strategy: { ...plan, via, cycle, at: now() }, stage: "Monitoring" } });
  m.cycle = cycle;
  m.nextCheckAt = nextCheckAt;
  const approvalNote = m.mode !== "autopilot" && plan.nextAngle && up ? " New ad ready — open Looi to approve." : "";
  notify(`Cycle ${cycle} update · ${m.name}`, (plan.userUpdate || plan.assessment || "Check complete.") + approvalNote, approvalNote ? "approval" : "update", m.id);
}

async function deviceRun() {
  const state = J(kvGet("looi_state"), null);
  if (!state?.settings?.apiKey) return;
  const due = (state.missions || []).filter((m: any) => m.status === "active" && (m.nextCheckAt || 0) <= now()).slice(0, 2);
  for (const m of due) {
    try {
      await checkOne(state, m);
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 300);
      event(m.id, "error", "Background check failed", msg);
      m.nextCheckAt = now() + 30 * 60000;
      push({ op: "mission", id: m.id, patch: { lastError: msg, nextCheckAt: m.nextCheckAt } });
    }
    CapacitorKV.set("looi_state", JSON.stringify(state));
  }
}

async function serverRun() {
  const server = kvGet("server");
  const device = kvGet("device");
  if (!server) return;
  const res = await fetch(server.replace(/\/$/, "") + "/api/live", { headers: { "X-Looi-Device": device || "" } });
  const live = await res.json();
  const lastSeen = Number(kvGet("lastNotif") || 0);
  const n = live.latest;
  const notes: any[] = [];
  if (n && n.id > lastSeen) {
    notes.push({ id: 1000 + (n.id % 100000), title: n.title, body: n.body || "" });
    CapacitorKV.set("lastNotif", String(n.id));
  }
  const pending = (live.approvals || []).length;
  const lastPending = Number(kvGet("lastPending") || 0);
  if (pending > lastPending) notes.push({ id: 7, title: "Approval needed", body: `${pending} ad batch${pending > 1 ? "es" : ""} waiting — tap to review.` });
  CapacitorKV.set("lastPending", String(pending));
  if (notes.length) CapacitorNotifications.schedule(notes);
}

addEventListener("looiCheck", async (resolve, reject, args) => {
  try {
    if (args && args.server) {
      CapacitorKV.set("mode", "server");
      CapacitorKV.set("server", args.server);
      CapacitorKV.set("device", args.device || "");
      return resolve();
    }
    let active = false;
    try {
      active = !!CapacitorApp?.getState()?.isActive;
    } catch {}
    if (active) return resolve(); // the app's own scheduler runs while it's open
    if (kvGet("mode") === "server") await serverRun();
    else await deviceRun();
    resolve();
  } catch (e) {
    reject(e);
  }
});

// App → runner: latest slim state (keys, missions, channels).
addEventListener("sync", (resolve, reject, args) => {
  try {
    CapacitorKV.set("mode", "device");
    if (args?.state) CapacitorKV.set("looi_state", typeof args.state === "string" ? args.state : JSON.stringify(args.state));
    resolve();
  } catch (e) {
    reject(e);
  }
});

// App ← runner: everything that happened in the background since the last pull.
addEventListener("pull", (resolve, reject) => {
  try {
    const o = readOutbox();
    CapacitorKV.set("looi_outbox", JSON.stringify({ ops: [] }));
    resolve({ ops: JSON.stringify(o.ops) });
  } catch (e) {
    reject(e);
  }
});
