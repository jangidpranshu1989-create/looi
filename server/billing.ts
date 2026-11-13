/**
 * Looi Cloud — accounts, freemium plans, usage limits and UPI payments (deep link + UTR verification).
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
for (const [c, d] of [["utr_at", "INTEGER NOT NULL DEFAULT 0"], ["note", "TEXT NOT NULL DEFAULT ''"], ["prev_plan", "TEXT NOT NULL DEFAULT ''"], ["prev_until", "INTEGER NOT NULL DEFAULT 0"], ["prev_start", "INTEGER NOT NULL DEFAULT 0"], ["provisional", "INTEGER NOT NULL DEFAULT 0"]]) {
  try {
    sqlite.exec(`ALTER TABLE payments ADD COLUMN ${c} ${d}`);
  } catch {}
}
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status); CREATE INDEX IF NOT EXISTS idx_payments_utr ON payments(payment_id);");

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

// ---------- UPI payments (deep link / QR + UTR verification)
export const UPI_ID = process.env.LOOI_UPI_ID || "8529418454@fam";
const UPI_NAME = process.env.LOOI_UPI_NAME || "Looi";
export const SUPPORT = { email: process.env.LOOI_SUPPORT_EMAIL || "jangid.pranshu1989@gmail.com", whatsapp: process.env.LOOI_SUPPORT_WHATSAPP || "918529418454" };
const PROVISIONAL_MS = Math.max(0, Number(process.env.LOOI_PROVISIONAL_HOURS ?? 48)) * 3600_000;
const ORDER_TTL = 48 * 3600_000;
const paymentsEnabled = () => !!UPI_ID;

interface PayRow {
  id: number; user_id: number; order_id: string; payment_id: string; plan: "pro" | "scale"; amount: number; status: string;
  created_at: number; paid_at: number; utr_at: number; note: string; prev_plan: string; prev_until: number; prev_start: number; provisional: number;
}
const upiUrl = (p: PayRow) =>
  `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_NAME)}&am=${(p.amount / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(p.order_id)}`;
const publicPayment = (p: PayRow) => ({
  id: p.id, orderId: p.order_id, plan: p.plan, amount: p.amount, amountInr: (p.amount / 100).toFixed(2), status: p.status, utr: p.payment_id,
  createdAt: p.created_at, utrAt: p.utr_at, paidAt: p.paid_at, note: p.note, provisional: !!p.provisional,
  expiresAt: p.created_at + ORDER_TTL, upiUrl: upiUrl(p), vpa: UPI_ID, payee: UPI_NAME,
});
function notify(userId: number, title: string, body: string, kind = "info") {
  try {
    sqlite.prepare("INSERT INTO notifications (owner_id,mission_id,approval_id,ts,kind,title,body,read) VALUES (?,?,?,?,?,?,?,0)").run(`u-${userId}`, 0, 0, Date.now(), kind, title, body);
  } catch {}
}
function notifyAdmins(title: string, body: string) {
  for (const email of ADMINS) {
    const a = sqlite.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number } | undefined;
    if (a) notify(a.id, title, body, "approval");
  }
}
/** Pick an amount with unique paise so each open order is easy to match in the UPI app history. */
function uniqueAmount(base: number) {
  const open = new Set((sqlite.prepare("SELECT amount FROM payments WHERE status IN ('created','submitted') AND created_at > ?").all(Date.now() - ORDER_TTL) as any[]).map((r) => r.amount));
  for (let i = 0; i < 200; i++) {
    const a = base * 100 + 1 + crypto.randomInt(99);
    if (!open.has(a)) return a;
  }
  return base * 100 + crypto.randomInt(100);
}
const newRef = () => "LOOI" + crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);

/** Final activation after the admin verifies the UTR in the UPI app. */
function approve(p: PayRow, by = "admin") {
  const u = getUser(p.user_id);
  if (!u || p.status === "paid") return false;
  const now = Date.now();
  // build on the plan the user had *before* any provisional access
  const basePlan = p.provisional ? p.prev_plan : u.plan;
  const baseUntil = p.provisional ? p.prev_until : u.plan_until;
  const baseStart = p.provisional ? p.prev_start : u.plan_start;
  const same = basePlan === p.plan && baseUntil > now;
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE payments SET status='paid', paid_at=?, note=? WHERE id=?").run(now, `verified by ${by}`, p.id);
    sqlite.prepare("UPDATE users SET plan=?, plan_until=?, plan_start=?, limit_notice=0 WHERE id=?").run(p.plan, (same ? baseUntil : now) + PERIOD, same ? baseStart || now : now, u.id);
  })();
  notify(u.id, `${PLANS[p.plan].label} is active`, `Payment ${p.order_id} (UTR ${p.payment_id}) verified. Thanks for backing Looi.`, "success");
  return true;
}
function reject(p: PayRow, reason: string) {
  const u = getUser(p.user_id);
  if (!u || p.status === "paid" || p.status === "rejected") return false;
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE payments SET status='rejected', note=? WHERE id=?").run(reason.slice(0, 300), p.id);
    if (p.provisional) sqlite.prepare("UPDATE users SET plan=?, plan_until=?, plan_start=? WHERE id=?").run(p.prev_plan || "free", p.prev_until, p.prev_start, u.id);
  })();
  notify(u.id, "Payment couldn't be verified", `We couldn't find UPI ref ${p.payment_id} for ₹${(p.amount / 100).toFixed(2)}. ${reason} Reply on WhatsApp +${SUPPORT.whatsapp} with a screenshot and we'll fix it.`, "warn");
  return true;
}

// ---------- request auth
const bearer = (req: Request) => {
  const h = req.header("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return String(req.query.token || "");
};
const PUBLIC = [/^\/api\/health$/, /^\/api\/meta$/, /^\/api\/auth\//, /^\/api\/me$/, /^\/api\/billing\/plans$/, /^\/api\/media\//, /^\/api\/public\//, /^\/api\/plugins\/callback$/];

/** Real client IP; behind Cloudflare the Worker forwards CF-Connecting-IP (only trusted when LOOI_TRUST_CF=1). */
const clientIp = (req: Request) => (process.env.LOOI_TRUST_CF === "1" && req.header("cf-connecting-ip")) || req.ip || "";
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
    res.json({ saas: SAAS, trialDays: TRIAL_DAYS, payments: paymentsEnabled(), upi: { vpa: UPI_ID, payee: UPI_NAME }, support: SUPPORT, plans: [PLANS.free, PLANS.pro, PLANS.scale] }),
  );

  app.get("/api/me", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    res.json({ saas: SAAS, user: u ? publicUser(getUser(u.id)!) : null, payments: paymentsEnabled(), upi: { vpa: UPI_ID, payee: UPI_NAME }, support: SUPPORT, trialDays: TRIAL_DAYS, plans: [PLANS.free, PLANS.pro, PLANS.scale] });
  });

  app.post("/api/auth/signup", (req, res) => {
    if (!SAAS) return res.status(400).json({ message: "Accounts are disabled on this server." });
    if (rateLimited("su:" + clientIp(req), 8, 3600_000)) return res.status(429).json({ message: "Too many sign-ups from this network. Try again later." });
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
    if (rateLimited("li:" + clientIp(req), 20, 900_000) || rateLimited("le:" + email, 10, 900_000)) return res.status(429).json({ message: "Too many attempts. Wait 15 minutes and try again." });
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

  // ---------- payments: 1) create order → UPI deep link / QR with unique amount  2) user submits UTR  3) admin verifies
  app.post("/api/billing/order", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!u) return res.status(401).json({ message: "Please sign in to continue." });
    if (!paymentsEnabled()) return res.status(503).json({ message: "Payments aren't switched on yet. Please check back soon." });
    if (rateLimited("ord:" + u.id, 12, 3600_000)) return res.status(429).json({ message: "Too many payment attempts. Try again in a while." });
    const plan = req.body?.plan === "scale" ? "scale" : "pro";
    // reuse an open, unpaid order for the same plan so refreshing doesn't change the amount
    const open = sqlite.prepare("SELECT * FROM payments WHERE user_id=? AND plan=? AND status='created' AND created_at > ? ORDER BY id DESC").get(u.id, plan, Date.now() - ORDER_TTL) as PayRow | undefined;
    if (open) return res.json(publicPayment(open));
    const amount = uniqueAmount(PLANS[plan].priceInr);
    const info = sqlite.prepare("INSERT INTO payments (user_id,order_id,plan,amount,currency,status,created_at) VALUES (?,?,?,?,?,?,?)").run(u.id, newRef(), plan, amount, "INR", "created", Date.now());
    res.json(publicPayment(sqlite.prepare("SELECT * FROM payments WHERE id=?").get(Number(info.lastInsertRowid)) as PayRow));
  });

  app.post("/api/billing/utr", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!u) return res.status(401).json({ message: "Please sign in to continue." });
    if (rateLimited("utr:" + u.id, 10, 3600_000)) return res.status(429).json({ message: "Too many attempts. Try again in an hour or message us on WhatsApp." });
    const utr = String(req.body?.utr || "").replace(/\s+/g, "");
    if (!/^\d{12}$/.test(utr)) return res.status(400).json({ message: "UTR / UPI Ref No. is the 12-digit number in your UPI app's payment details." });
    const p = sqlite.prepare("SELECT * FROM payments WHERE order_id=? AND user_id=?").get(String(req.body?.orderId || ""), u.id) as PayRow | undefined;
    if (!p) return res.status(404).json({ message: "Order not found. Start the payment again." });
    if (p.status !== "created") return res.status(409).json({ message: p.status === "paid" ? "This payment is already verified." : "A UTR was already submitted for this order." });
    if (Date.now() - p.created_at > ORDER_TTL) return res.status(410).json({ message: "This payment request expired. Start a new one; if you already paid, message us on WhatsApp." });
    const dup = sqlite.prepare("SELECT id FROM payments WHERE payment_id=? AND id != ?").get(utr, p.id);
    if (dup) return res.status(409).json({ message: "This UTR was already used for another payment." });
    const now = Date.now();
    // provisional access while we verify — not for accounts with a previously rejected UTR
    const flagged = !!sqlite.prepare("SELECT id FROM payments WHERE user_id=? AND status='rejected'").get(u.id);
    const give = PROVISIONAL_MS > 0 && !flagged;
    sqlite.transaction(() => {
      sqlite.prepare("UPDATE payments SET status='submitted', payment_id=?, utr_at=?, prev_plan=?, prev_until=?, prev_start=?, provisional=? WHERE id=?").run(utr, now, u.plan, u.plan_until, u.plan_start, give ? 1 : 0, p.id);
      if (give) {
        const same = u.plan === p.plan && u.plan_until > now;
        sqlite.prepare("UPDATE users SET plan=?, plan_until=?, plan_start=?, limit_notice=0 WHERE id=?").run(p.plan, same ? u.plan_until : now + PROVISIONAL_MS, same ? u.plan_start : now, u.id);
      }
    })();
    notifyAdmins("Verify UPI payment", `${u.email} · ${PLANS[p.plan].label} · ₹${(p.amount / 100).toFixed(2)} · UTR ${utr} · ${p.order_id}`);
    res.json({ ok: true, provisional: give, payment: publicPayment(sqlite.prepare("SELECT * FROM payments WHERE id=?").get(p.id) as PayRow), user: publicUser(getUser(u.id)!) });
  });

  app.get("/api/billing/history", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!u) return res.status(401).json({ message: "Please sign in to continue." });
    res.json((sqlite.prepare("SELECT * FROM payments WHERE user_id=? AND status != 'created' ORDER BY id DESC LIMIT 50").all(u.id) as PayRow[]).map(publicPayment));
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
      paying: n("SELECT count(*) n FROM users u WHERE plan IN ('pro','scale') AND plan_until > ? AND EXISTS (SELECT 1 FROM payments p WHERE p.user_id=u.id AND p.status='paid')", now),
      provisional: n("SELECT count(DISTINCT user_id) n FROM payments WHERE status='submitted' AND provisional=1"),
      pendingPayments: n("SELECT count(*) n FROM payments WHERE status='submitted'"),
      revenue30dInr: Math.round(n("SELECT coalesce(sum(amount),0) n FROM payments WHERE status='paid' AND paid_at >= ?", now - PERIOD) / 100),
      revenueAllInr: Math.round(n("SELECT coalesce(sum(amount),0) n FROM payments WHERE status='paid'") / 100),
      missions: n("SELECT count(*) n FROM missions"),
      activeMissions: n("SELECT count(*) n FROM missions WHERE status IN ('active','running','queued')"),
      ads: n("SELECT count(*) n FROM creatives WHERE status != 'failed'"),
      posts: n("SELECT count(*) n FROM posts WHERE status='published'"),
    });
  });
  app.get("/api/admin/payments", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!isAdmin(u)) return res.status(403).json({ message: "Admins only." });
    const st = String(req.query.status || "submitted");
    const rows = sqlite.prepare(`SELECT p.*, u.email FROM payments p JOIN users u ON u.id = p.user_id ${st === "all" ? "WHERE p.status != 'created'" : "WHERE p.status = ?"} ORDER BY p.id DESC LIMIT 200`).all(...(st === "all" ? [] : [st])) as (PayRow & { email: string })[];
    res.json(rows.map((r) => ({ ...publicPayment(r), email: r.email })));
  });
  app.post("/api/admin/payments/:id/:action", (req, res) => {
    const u = (req as any).user as UserRow | undefined;
    if (!isAdmin(u)) return res.status(403).json({ message: "Admins only." });
    const p = sqlite.prepare("SELECT * FROM payments WHERE id=?").get(Number(req.params.id)) as PayRow | undefined;
    if (!p) return res.status(404).json({ message: "Payment not found." });
    const ok = req.params.action === "approve" ? approve(p, u!.email) : req.params.action === "reject" ? reject(p, String(req.body?.reason || "No matching payment found.")) : false;
    if (!ok) return res.status(409).json({ message: "Nothing to change for this payment." });
    res.json(publicPayment(sqlite.prepare("SELECT * FROM payments WHERE id=?").get(p.id) as PayRow));
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
