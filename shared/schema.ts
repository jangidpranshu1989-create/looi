import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/** Per-owner settings (owner = device / visitor id) */
export const settings = sqliteTable("settings", {
  ownerId: text("owner_id").primaryKey(),
  provider: text("provider").notNull().default("builtin"), // builtin | groq | nvidia | openai | custom
  baseUrl: text("base_url").notNull().default(""),
  apiKey: text("api_key").notNull().default(""),
  model: text("model").notNull().default(""),
  builtinFallback: integer("builtin_fallback", { mode: "boolean" }).notNull().default(true),
  aiVisuals: integer("ai_visuals", { mode: "boolean" }).notNull().default(true),
  intervalMinutes: integer("interval_minutes").notNull().default(150),
  defaultMode: text("default_mode").notNull().default("approval"), // approval | autopilot
  publicBaseUrl: text("public_base_url").notNull().default(""),
  psiKey: text("psi_key").notNull().default(""),
  brandVoice: text("brand_voice").notNull().default(""),
  language: text("language").notNull().default("English"),
  composioKey: text("composio_key").notNull().default(""),
});

export const missions = sqliteTable("missions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  url: text("url").notNull(),
  name: text("name").notNull().default(""),
  favicon: text("favicon").notNull().default(""),
  status: text("status").notNull().default("queued"), // queued | running | active | paused | failed
  stage: text("stage").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  mode: text("mode").notNull().default("approval"),
  goal: text("goal").notNull().default(""),
  channelIds: text("channel_ids").notNull().default("[]"),
  cycle: integer("cycle").notNull().default(0),
  site: text("site").notNull().default("{}"), // extracted site data
  report: text("report").notNull().default("{}"), // audit report
  brief: text("brief").notNull().default("{}"), // marketing brief
  strategy: text("strategy").notNull().default("{}"), // latest strategist decision
  healthScore: integer("health_score").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  lastCheckAt: integer("last_check_at").notNull().default(0),
  nextCheckAt: integer("next_check_at").notNull().default(0),
});

export const creatives = sqliteTable("creatives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  missionId: integer("mission_id").notNull(),
  cycle: integer("cycle").notNull().default(0),
  angle: text("angle").notNull().default(""),
  template: text("template").notNull().default(""),
  format: text("format").notNull().default("square"), // square | story | landscape
  copy: text("copy").notNull().default("{}"),
  posterFile: text("poster_file").notNull().default(""),
  videoFile: text("video_file").notNull().default(""),
  status: text("status").notNull().default("draft"), // rendering | draft | pending | approved | published | rejected | failed
  createdAt: integer("created_at").notNull(),
});

export const channels = sqliteTable("channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  type: text("type").notNull(), // composio | webhook
  name: text("name").notNull(),
  config: text("config").notNull().default("{}"),
  status: text("status").notNull().default("unverified"), // unverified | connected | error
  lastError: text("last_error").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  missionId: integer("mission_id").notNull(),
  creativeId: integer("creative_id").notNull(),
  channelId: integer("channel_id").notNull(),
  channelType: text("channel_type").notNull(),
  linkCode: text("link_code").notNull(),
  externalId: text("external_id").notNull().default(""),
  externalUrl: text("external_url").notNull().default(""),
  status: text("status").notNull().default("queued"), // queued | published | failed
  error: text("error").notNull().default(""),
  metrics: text("metrics").notNull().default("{}"),
  publishedAt: integer("published_at").notNull().default(0),
});

export const clicks = sqliteTable("clicks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  linkCode: text("link_code").notNull(),
  missionId: integer("mission_id").notNull(),
  postId: integer("post_id").notNull().default(0),
  kind: text("kind").notNull().default("click"), // click | visit
  ts: integer("ts").notNull(),
  referrer: text("referrer").notNull().default(""),
  ua: text("ua").notNull().default(""),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  missionId: integer("mission_id").notNull(),
  ts: integer("ts").notNull(),
  kind: text("kind").notNull(), // step | info | success | warn | error | decision
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
});

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  missionId: integer("mission_id").notNull().default(0),
  approvalId: integer("approval_id").notNull().default(0),
  ts: integer("ts").notNull(),
  kind: text("kind").notNull().default("info"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
});

export const approvals = sqliteTable("approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  missionId: integer("mission_id").notNull(),
  kind: text("kind").notNull(), // publish | pivot
  title: text("title").notNull(),
  payload: text("payload").notNull().default("{}"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  createdAt: integer("created_at").notNull(),
  decidedAt: integer("decided_at").notNull().default(0),
});

export const snapshots = sqliteTable("snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  missionId: integer("mission_id").notNull(),
  ts: integer("ts").notNull(),
  cycle: integer("cycle").notNull().default(0),
  data: text("data").notNull().default("{}"), // scores, clicks, ttfb, etc
});

export const playbooks = sqliteTable("playbooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  missionId: integer("mission_id").notNull(),
  cycle: integer("cycle").notNull().default(0),
  channel: text("channel").notNull(), // product_hunt | reddit | hacker_news | seo_blog | cold_email | influencer | ...
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("ready"), // ready | done
  createdAt: integer("created_at").notNull(),
});

export const insertMissionSchema = z.object({
  url: z.string().min(4),
  mode: z.enum(["approval", "autopilot"]).optional(),
  goal: z.string().optional(),
  channelIds: z.array(z.number()).optional(),
});
export const insertChannelSchema = createInsertSchema(channels).omit({ id: true, ownerId: true, status: true, lastError: true, createdAt: true });
export const updateSettingsSchema = createInsertSchema(settings).omit({ ownerId: true }).partial();

export type Settings = typeof settings.$inferSelect;
export type Mission = typeof missions.$inferSelect;
export type Creative = typeof creatives.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Click = typeof clicks.$inferSelect;
export type AgentEvent = typeof events.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type Playbook = typeof playbooks.$inferSelect;
export type InsertMission = z.infer<typeof insertMissionSchema>;
export type InsertChannel = z.infer<typeof insertChannelSchema>;
