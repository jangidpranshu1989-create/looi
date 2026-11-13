/**
 * Looi Cloud — accounts, freemium plans, usage limits and Razorpay payments.
 *
 * Enabled when LOOI_SAAS=1. When disabled (self-hosting for yourself) every
 * request is the single "local" owner with unlimited usage.
 */
import crypto from "node:crypto";
import type { Request, Response, NextFunction, Express } from "express";
import { sqlite } from "./storage";

export const SAAS = process.env.LOOI_SAAS === "1" || process.env.LOOI_SAAS === "true";
const TRIAL_DAYS = Math.max(0, parseInt(process.env.LOOI_TRIAL_DAYS || "7", 10) || 7);
const DAY = 86_400_000;
const PERIOD = 30 * DAY;
const ADMINS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export type PlanKey = "trial" | "free" | "pro" | "scale" | "unlimited";
export interface Plan {
  key: PlanKey;
  label: string;
  priceInr: number;
  missions: number; // active missions at once
  audits: number; // new site launches (deep audit + ad batch) per 30 days
  creatives: number; // rendered video ads per 30 days
  minInterval: number; // fastest re-check cadence (minutes)
  autopilot: boolean;
  priority: number; // queue priority (higher runs first)
}
const price = (k: string, d: number) => Math.max(1, parseInt(process.env[k] || String(d), 10) || d);
export const PLANS: Record<PlanKey, Plan> = {
  trial: { key: "trial", label: "Free trial", priceInr: 0, missions: 2, audits: 4, creatives: 24, minInterval: 150, autopilot: true, priority: 2 },
  free: { key: "free", label: "Free", priceInr: 0, missions: 1, audits: 2, creatives: 6, minInterval: 720, autopilot: false, priority: 1 },
  pro: { key: "pro", label: "Pro", priceInr: price("LOOI_PRICE_PRO_INR", 999), missions: 5, audits: 40, creatives: 200, minInterval: 120, autopilot: true, priority: 3 },
  scale: { key: "scale", label: "Scale", priceInr: price("LOOI_PRICE_SCALE_INR", 2999), missions: 25, audits: 200, creatives: 1000, minInterval: 60, autopilot: true, priority: 4 },
  unlimited: { key: "unlimited", label: "Unlimited", priceInr: 0, missions: 10_000, audits: 1e9, creatives: 1e9, minInterval: 30, autopilot: true, priority: 5 },
};

// ---------- tables
sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pass TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_until INTEGER NOT NULL DEFAULT 0,
  plan_start INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0,
  limit_notice INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ua TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  payment_id TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created',
  created_at INTEGER NOT NULL,
  paid_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

interface UserRow {
  id: number;
  email: string;
  name: string;
  pass: string;
  plan: string;
  plan_until: number;
  plan_start: number;
  created_at: number;
  last_seen: number;
  limit_notice: number;
}

// ---------- passwords & sessions
function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString("hex")}$${key.toString("hex")}`;
}
function checkPassword(pw: string, stored: string) {
  const [v, s, k] = stored.split("$");
  if (v !== "s1" || !s || !k) return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, "hex"), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, "hex");
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
function newSession(userId: number, ua = "") {
  const token = "lk_" + crypto.randomBytes(32).toString("base64url");
  sqlite.prepare("INSERT INTO sessions (token_hash,user_id,created_at,ua) VALUES (?,?,?,?)").run(sha(token), userId, Date.now(), ua.slice(0, 200));
  return token;
}
function userFromToken(token: string): UserRow | undefined {
  if (!token) return;
  const row = sqlite.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").get(sha(token)) as UserRow | undefined;
  return row;
}
const getUser = (id: number) => sqlite.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
const ownerOf = (u: UserRow) => `u-${u.id}`;
const userIdFromOwner = (owner: string) => (owner.startsWith("u-") ? parseInt(owner.slice(2), 10) : 0);

// ---------- plan resolution
const isAdmin = (u?: UserRow) => !!u && ADMINS.includes(u.email.toLowerCase());
function trialEnds(u: UserRow) {
  return u.created_at + TRIAL_DAYS * DAY;
}
function effective(u: UserRow): { plan: Plan; periodStart: number } {
  const now = Date.now();
  if (isAdmin(u)) return { plan: PLANS.unlimited, periodStart: now - PERIOD };
  if ((u.plan === "pro" || u.plan === "scale") && u.plan_until > now) {
    // rolling 30-day windows from the payment date
    const start = u.plan_start || now - PERIOD;
    const windows = Math.floor((now - start) / PERIOD);
    return { plan: PLANS[u.plan], periodStart: start + windows * PERIOD };
  }
  if (now < trialEnds(u)) return { plan: PLANS.trial, periodStart: u.created_at };
  const after = Math.max(trialEnds(u), u.plan_until || 0);
  return { plan: PLANS.free, periodStart: Math.max(after, now - PERIOD) };
}

function usage(owner: string, since: number) {
  const q = (sql: string) => (sqlite.prepare(sql).get(owner, since) as any)?.n ?? 0;
  return {
    audits: q("SELECT count(*) n FROM missions WHERE owner_id = ? AND created_at >= ?"),
    creatives: q("SELECT count(*) n FROM creatives WHERE owner_id = ? AND created_at >= ? AND status != 'failed'"),
    missions: (sqlite.prepare("SELECT count(*) n FROM missions WHERE owner_id = ? AND status NOT IN ('paused','failed')").get(owner) as any)?.n ?? 0,
  };
}

/** Plan for a mission owner (anything not a Looi Cloud account is unlimited). */
export function planFor(owner: string): { plan: Plan; periodStart: number; user?: UserRow } {
  if (!SAAS) return { plan: PLANS.unlimited, periodStart: Date.now() - PERIOD };
  const u = getUser(userIdFromOwner(owner));
  if (!u) return { plan: PLANS.free, periodStart: Date.now() - PERIOD };
  return { ...effective(u), user: u };
}

export class LimitError extends Error {
  status = 402;
  constructor(msg: string) {
    super(msg);
  }
}
const UPGRADE = "Upgrade in Billing to keep going.";
export function assertCanLaunch(owner: string) {
  const { plan, periodStart } = planFor(owner);
  const u = usage(owner, periodStart);
  if (u.missions >= plan.missions) throw new LimitError(`Your ${plan.label} plan runs ${plan.missions} active mission${plan.missions > 1 ? "s" : ""} at a time. Pause one or upgrade.`);
  if (u.audits >= plan.audits) throw new LimitError(`You've used all ${plan.audits} site launches in this period. ${UPGRADE}`);
}
export function canCreate(owner: string) {
  const { plan, periodStart } = planFor(owner);
  return usage(owner, periodStart).creatives < plan.creatives;
}
export function assertCanCreate(owner: string) {
  const { plan } = planFor(owner);
  if (!canCreate(owner)) throw new LimitError(`You've used all ${plan.creatives} ads in this period. ${UPGRADE}`);
}
/** Called when the agent skips work because of the plan; returns true once per day so we don't spam. */
export function shouldNoticeLimit(owner: string) {
  const id = userIdFromOwner(owner);
  if (!SAAS || !id) return false;
  const u = getUser(id);
  if (!u || Date.now() - u.limit_notice < DAY) return false;
  sqlite.prepare("UPDATE users SET limit_notice = ? WHERE id = ?").run(Date.now(), id);
  return true;
}
export function intervalFor(owner: string, wanted: number) {
  return Math.max(wanted || 150, planFor(owner).plan.minInterval);
}
export function autopilotAllowed(owner: string) {
  return planFor(owner).plan.autopilot;
}
export function priorityFor(owner: string) {
  return planFor(owner).plan.priority;
}

// ---------- Razorpay
const RZP_ID = process.env.RAZORPAY_KEY_ID || "";
const RZP_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const RZP_WEBHOOK = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const paymentsEnabled = () => !!(RZP_ID && RZP_SECRET);

function activate(userId: number, plan: "pro" | "scale", orderId: string, paymentId: string) {
  const p = sqlite.prepare("SELECT * FROM payments WHERE order_id = ?").get(orderId) as any;
  if (!p || p.status === "paid") return false;
  const u = getUser(userId);
  if (!u) return false;
  const now = Date.now();
  // extend from the current paid-until if still active on the same plan, otherwise start now
  const from = u.plan === plan && u.plan_until > now ? u.plan_until : now;
  const start = u.plan === plan && u.plan_until > now ? u.plan_start || now : now;
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE payments SET status='paid', payment_id=?, paid_at=? WHERE order_id=?").run(paymentId, now, orderId);
    sqlite.prepare("UPDATE users SET plan=?, plan_until=?, plan_start=?, limit_notice=0 WHERE id=?").run(plan, from + PERIOD, start, userId);
  })();
  return true;
}

// ---------- request auth
const bearer = (req: Request) => {
  const h = req.header("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return String(req.query.token || "");
};
const PUBLIC = [/^\/api\/health$/, /^\/api\/meta$/, /^\/api\/auth\//, /^\/api\/me$/, /^\/api\/billing\/plans$/, /^\/api\/billing\/webhook$/, /^\/api\/media\//, /^\/api\/public\//, /^\/api\/plugins\/callback$/];

const hits = new Map<string, { n: number; t: number }>();
function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > windowMs) {
    hits.set(key, { n: 1, t: now });
    return false;
  }
  h.n++;
  return h.n > max;
}

function publicUser(u: UserRow) {
  const { plan, periodStart } = effective(u);
  const use = usage(ownerOf(u), periodStart);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    admin: isAdmin(u),
    plan: { ...plan },
    usage: use,
    periodStart,
    periodEnd: plan.key === "trial" ? trialEnds(u) : periodStart + PERIOD,
    trialEndsAt: trialEnds(u),
    paidUntil: u.plan_until,
    createdAt: u.created_at,
  };
}

export function installAuth(app: Express) {
  // resolve the owner for every API call
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!SAAS) return next();
    const u = userFromToken(bearer(req));
    if (u) {
      (req as any).ownerId = ownerOf(u);
      (req as any).user = u;
      if (Date.now() - u.last_seen > 10 * 60_000) sqlite.prepare("UPDATE users SET last_seen=? WHERE id=?").run(Date.now(), u.id);
      return next();
    }
    if (!req.path.startsWith("/api/") || PUBLIC.some((r) => r.test(req.path))) return next();
    return res.status(401).json({ message: "Please sign in to continue." });
  });

  app.get("/api/billing/plans", (_req, res) =>
    res.json({ saas: SAAS, trialDays: TRIAL_DAYS, payments: paymentsEnabled(), plans: [PLANS.free, PLANS.pro, PLANS.scale] }),
  );

  app.get("/api/me", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    res.json({ saas: SAAS, user: u ? publicUser(getUser(u.id)!) : null, payments: paymentsEnabled(), razorpayKeyId: paymentsEnabled() ? RZP_ID : "", trialDays: TRIAL_DAYS, plans: [PLANS.free, PLANS.pro, PLANS.scale] });
  });

  app.post("/api/auth/signup", (req, res) => {
    if (!SAAS) return res.status(400).json({ message: "Accounts are disabled on this server." });
    if (rateLimited("su:" + req.ip, 8, 3600_000)) return res.status(429).json({ message: "Too many sign-ups from this network. Try again later." });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim().slice(0, 80);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) return res.status(400).json({ message: "Enter a valid email address." });
    if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters." });
    if (sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email)) return res.status(409).json({ message: "An account with this email already exists. Sign in instead." });
    const now = Date.now();
    const info = sqlite.prepare("INSERT INTO users (email,name,pass,plan,created_at,last_seen) VALUES (?,?,?,?,?,?)").run(email, name, hashPassword(password), "free", now, now);
    const u = getUser(Number(info.lastInsertRowid))!;
    res.json({ token: newSession(u.id, req.header("user-agent") || ""), user: publicUser(u) });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!SAAS) return res.status(400).json({ message: "Accounts are disabled on this server." });
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (rateLimited("li:" + req.ip, 20, 900_000) || rateLimited("le:" + email, 10, 900_000)) return res.status(429).json({ message: "Too many attempts. Wait 15 minutes and try again." });
    const u = sqlite.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
    if (!u || !checkPassword(String(req.body?.password || ""), u.pass)) return res.status(401).json({ message: "Wrong email or password." });
    res.json({ token: newSession(u.id, req.header("user-agent") || ""), user: publicUser(u) });
  });

  app.post("/api/auth/logout", (req, res) => {
    const t = bearer(req);
    if (t) sqlite.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(t));
    res.json({ ok: true });
  });

  app.post("/api/auth/password", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!u) return res.status(401).json({ message: "Please sign in to continue." });
    if (!checkPassword(String(req.body?.current || ""), u.pass)) return res.status(400).json({ message: "Current password is wrong." });
    const next = String(req.body?.password || "");
    if (next.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters." });
    sqlite.prepare("UPDATE users SET pass=? WHERE id=?").run(hashPassword(next), u.id);
    sqlite.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash != ?").run(u.id, sha(bearer(req)));
    res.json({ ok: true });
  });

  /** Account deletion (required by Google Play for apps with sign-up). */
  app.post("/api/auth/delete", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!u) return res.status(401).json({ message: "Please sign in to continue." });
    if (!checkPassword(String(req.body?.password || ""), u.pass)) return res.status(400).json({ message: "Password is wrong." });
    const owner = ownerOf(u);
    sqlite.transaction(() => {
      for (const t of ["settings", "missions", "creatives", "channels", "posts", "events", "notifications", "approvals", "playbooks"]) sqlite.prepare(`DELETE FROM ${t} WHERE owner_id = ?`).run(owner);
      sqlite.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
      sqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    })();
    res.json({ ok: true });
  });

  // ---------- payments
  app.post("/api/billing/order", async (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!u) return res.status(401).json({ message: "Please sign in to continue." });
    if (!paymentsEnabled()) return res.status(503).json({ message: "Payments aren't switched on yet. Please check back soon." });
    const plan = req.body?.plan === "scale" ? "scale" : "pro";
    const amount = PLANS[plan].priceInr * 100;
    try {
      const r = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${RZP_ID}:${RZP_SECRET}`).toString("base64") },
        body: JSON.stringify({ amount, currency: "INR", receipt: `looi_${u.id}_${Date.now()}`, notes: { userId: String(u.id), plan } }),
        signal: AbortSignal.timeout(20_000),
      });
      const j: any = await r.json();
      if (!r.ok) throw new Error(j?.error?.description || `Razorpay ${r.status}`);
      sqlite.prepare("INSERT INTO payments (user_id,order_id,plan,amount,currency,status,created_at) VALUES (?,?,?,?,?,?,?)").run(u.id, j.id, plan, amount, "INR", "created", Date.now());
      res.json({ orderId: j.id, amount, currency: "INR", keyId: RZP_ID, plan, name: PLANS[plan].label, email: u.email, userName: u.name });
    } catch (e) {
      res.status(502).json({ message: "Couldn't start the payment: " + String((e as Error).message).slice(0, 200) });
    }
  });

  app.post("/api/billing/verify", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!u) return res.status(401).json({ message: "Please sign in to continue." });
    const { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: s } = req.body || {};
    if (!o || !p || !s) return res.status(400).json({ message: "Missing payment details." });
    const want = crypto.createHmac("sha256", RZP_SECRET).update(`${o}|${p}`).digest("hex");
    if (want.length !== String(s).length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(s)))) return res.status(400).json({ message: "Payment signature didn't match." });
    const row = sqlite.prepare("SELECT * FROM payments WHERE order_id = ? AND user_id = ?").get(o, u.id) as any;
    if (!row) return res.status(404).json({ message: "Order not found." });
    activate(u.id, row.plan, o, p);
    res.json({ ok: true, user: publicUser(getUser(u.id)!) });
  });

  // Razorpay webhook: payment.captured / order.paid (safety net if the app closes mid-checkout)
  app.post("/api/billing/webhook", (req, res) => {
    if (!RZP_WEBHOOK) return res.sendStatus(204);
    const sig = req.header("x-razorpay-signature") || "";
    const raw = (req as any).rawBody as Buffer | undefined;
    if (!raw) return res.sendStatus(400);
    const want = crypto.createHmac("sha256", RZP_WEBHOOK).update(raw).digest("hex");
    if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return res.sendStatus(400);
    const ev = req.body || {};
    const pay = ev.payload?.payment?.entity;
    const orderId = pay?.order_id || ev.payload?.order?.entity?.id;
    if ((ev.event === "payment.captured" || ev.event === "order.paid") && orderId) {
      const row = sqlite.prepare("SELECT * FROM payments WHERE order_id = ?").get(orderId) as any;
      if (row) activate(row.user_id, row.plan, orderId, pay?.id || "");
    }
    res.json({ ok: true });
  });

  // ---------- admin
  app.get("/api/admin/stats", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!isAdmin(u)) return res.status(403).json({ message: "Admins only." });
    const n = (sql: string, ...a: any[]) => (sqlite.prepare(sql).get(...a) as any)?.n ?? 0;
    const now = Date.now();
    res.json({
      users: n("SELECT count(*) n FROM users"),
      newUsers7d: n("SELECT count(*) n FROM users WHERE created_at >= ?", now - 7 * DAY),
      active7d: n("SELECT count(*) n FROM users WHERE last_seen >= ?", now - 7 * DAY),
      paying: n("SELECT count(*) n FROM users WHERE plan IN ('pro','scale') AND plan_until > ?", now),
      revenue30dInr: Math.round(n("SELECT coalesce(sum(amount),0) n FROM payments WHERE status='paid' AND paid_at >= ?", now - PERIOD) / 100),
      revenueAllInr: Math.round(n("SELECT coalesce(sum(amount),0) n FROM payments WHERE status='paid'") / 100),
      missions: n("SELECT count(*) n FROM missions"),
      activeMissions: n("SELECT count(*) n FROM missions WHERE status IN ('active','running','queued')"),
      ads: n("SELECT count(*) n FROM creatives WHERE status != 'failed'"),
      posts: n("SELECT count(*) n FROM posts WHERE status='published'"),
    });
  });
  app.post("/api/admin/grant", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!isAdmin(u)) return res.status(403).json({ message: "Admins only." });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const plan = req.body?.plan === "scale" ? "scale" : req.body?.plan === "free" ? "free" : "pro";
    const days = Math.min(3650, Math.max(1, parseInt(req.body?.days || "30", 10) || 30));
    const t = sqlite.prepare("SELECT * FROM users WHERE email=?").get(email) as UserRow | undefined;
    if (!t) return res.status(404).json({ message: "No user with that email." });
    sqlite.prepare("UPDATE users SET plan=?, plan_until=?, plan_start=? WHERE id=?").run(plan, plan === "free" ? 0 : Date.now() + days * DAY, Date.now(), t.id);
    res.json({ ok: true, user: publicUser(getUser(t.id)!) });
  });
}
