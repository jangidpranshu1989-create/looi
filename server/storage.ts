import * as s from "@shared/schema";
import type { Settings, Mission, Creative, Channel, Post, Approval, Playbook } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.LOOI_DATA_DIR || path.resolve("looi-data");
fs.mkdirSync(path.join(DATA_DIR, "media"), { recursive: true });

const sqlite = new Database(process.env.LOOI_DB || "data.db");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

const now = () => Date.now();

class Storage {
  // ---------- settings
  getSettings(ownerId: string): Settings {
    let row = db.select().from(s.settings).where(eq(s.settings.ownerId, ownerId)).get();
    if (!row) row = db.insert(s.settings).values({ ownerId }).returning().get();
    return row;
  }
  updateSettings(ownerId: string, patch: Partial<Settings>): Settings {
    this.getSettings(ownerId);
    return db.update(s.settings).set(patch).where(eq(s.settings.ownerId, ownerId)).returning().get();
  }

  // ---------- missions
  createMission(ownerId: string, v: Partial<Mission> & { url: string }): Mission {
    return db.insert(s.missions).values({ ownerId, createdAt: now(), ...v }).returning().get();
  }
  getMission(id: number): Mission | undefined {
    return db.select().from(s.missions).where(eq(s.missions.id, id)).get();
  }
  listMissions(ownerId: string): Mission[] {
    return db.select().from(s.missions).where(eq(s.missions.ownerId, ownerId)).orderBy(desc(s.missions.id)).all();
  }
  updateMission(id: number, patch: Partial<Mission>): Mission {
    return db.update(s.missions).set(patch).where(eq(s.missions.id, id)).returning().get();
  }
  deleteMission(id: number) {
    for (const t of [s.creatives, s.posts, s.events, s.approvals, s.playbooks] as any[]) db.delete(t).where(eq(t.missionId, id)).run();
    db.delete(s.snapshots).where(eq(s.snapshots.missionId, id)).run();
    db.delete(s.clicks).where(eq(s.clicks.missionId, id)).run();
    db.delete(s.missions).where(eq(s.missions.id, id)).run();
  }
  dueMissions(): Mission[] {
    return db.select().from(s.missions).where(and(eq(s.missions.status, "active"), lte(s.missions.nextCheckAt, now()))).all();
  }
  missionsByStatus(status: string): Mission[] {
    return db.select().from(s.missions).where(eq(s.missions.status, status)).all();
  }

  // ---------- creatives
  createCreative(v: Omit<Creative, "id" | "createdAt"> & Partial<Creative>): Creative {
    return db.insert(s.creatives).values({ createdAt: now(), ...v } as any).returning().get();
  }
  updateCreative(id: number, patch: Partial<Creative>): Creative {
    return db.update(s.creatives).set(patch).where(eq(s.creatives.id, id)).returning().get();
  }
  getCreative(id: number) {
    return db.select().from(s.creatives).where(eq(s.creatives.id, id)).get();
  }
  listCreatives(missionId: number): Creative[] {
    return db.select().from(s.creatives).where(eq(s.creatives.missionId, missionId)).orderBy(desc(s.creatives.id)).all();
  }
  listCreativesByOwner(ownerId: string): Creative[] {
    return db.select().from(s.creatives).where(eq(s.creatives.ownerId, ownerId)).orderBy(desc(s.creatives.id)).all();
  }

  // ---------- channels
  listChannels(ownerId: string): Channel[] {
    return db.select().from(s.channels).where(eq(s.channels.ownerId, ownerId)).orderBy(desc(s.channels.id)).all();
  }
  getChannel(id: number) {
    return db.select().from(s.channels).where(eq(s.channels.id, id)).get();
  }
  createChannel(ownerId: string, v: { type: string; name: string; config: string }): Channel {
    return db.insert(s.channels).values({ ownerId, createdAt: now(), ...v }).returning().get();
  }
  updateChannel(id: number, patch: Partial<Channel>) {
    return db.update(s.channels).set(patch).where(eq(s.channels.id, id)).returning().get();
  }
  deleteChannel(id: number) {
    db.delete(s.channels).where(eq(s.channels.id, id)).run();
  }

  // ---------- posts & clicks
  createPost(v: Omit<Post, "id">): Post {
    return db.insert(s.posts).values(v).returning().get();
  }
  updatePost(id: number, patch: Partial<Post>) {
    return db.update(s.posts).set(patch).where(eq(s.posts.id, id)).returning().get();
  }
  listPosts(missionId: number): Post[] {
    return db.select().from(s.posts).where(eq(s.posts.missionId, missionId)).orderBy(desc(s.posts.id)).all();
  }
  postByCode(code: string) {
    return db.select().from(s.posts).where(eq(s.posts.linkCode, code)).get();
  }
  addClick(v: Omit<s.Click, "id">) {
    db.insert(s.clicks).values(v).run();
  }
  clicksFor(missionId: number, since = 0) {
    return db.select().from(s.clicks).where(and(eq(s.clicks.missionId, missionId), gte(s.clicks.ts, since))).all();
  }

  // ---------- events / notifications / approvals / snapshots / playbooks
  addEvent(ownerId: string, missionId: number, kind: string, title: string, detail = "") {
    return db.insert(s.events).values({ ownerId, missionId, kind, title, detail, ts: now() }).returning().get();
  }
  listEvents(missionId: number, limit = 200) {
    return db.select().from(s.events).where(eq(s.events.missionId, missionId)).orderBy(desc(s.events.id)).limit(limit).all();
  }
  notify(ownerId: string, v: { title: string; body?: string; kind?: string; missionId?: number; approvalId?: number }) {
    return db.insert(s.notifications).values({ ownerId, ts: now(), body: "", kind: "info", ...v }).returning().get();
  }
  listNotifications(ownerId: string, limit = 60) {
    return db.select().from(s.notifications).where(eq(s.notifications.ownerId, ownerId)).orderBy(desc(s.notifications.id)).limit(limit).all();
  }
  markAllRead(ownerId: string) {
    db.update(s.notifications).set({ read: true }).where(eq(s.notifications.ownerId, ownerId)).run();
  }
  unreadCount(ownerId: string): number {
    const r = db.select({ c: sql<number>`count(*)` }).from(s.notifications).where(and(eq(s.notifications.ownerId, ownerId), eq(s.notifications.read, false))).get();
    return r?.c ?? 0;
  }
  createApproval(v: Omit<Approval, "id" | "createdAt" | "decidedAt" | "status">): Approval {
    return db.insert(s.approvals).values({ ...v, createdAt: now() }).returning().get();
  }
  getApproval(id: number) {
    return db.select().from(s.approvals).where(eq(s.approvals.id, id)).get();
  }
  listApprovals(ownerId: string, status?: string) {
    const cond = status ? and(eq(s.approvals.ownerId, ownerId), eq(s.approvals.status, status)) : eq(s.approvals.ownerId, ownerId);
    return db.select().from(s.approvals).where(cond).orderBy(desc(s.approvals.id)).limit(100).all();
  }
  decideApproval(id: number, status: string) {
    return db.update(s.approvals).set({ status, decidedAt: now() }).where(eq(s.approvals.id, id)).returning().get();
  }
  addSnapshot(missionId: number, cycle: number, data: unknown) {
    db.insert(s.snapshots).values({ missionId, cycle, ts: now(), data: JSON.stringify(data) }).run();
  }
  listSnapshots(missionId: number) {
    return db.select().from(s.snapshots).where(eq(s.snapshots.missionId, missionId)).orderBy(s.snapshots.id).all();
  }
  addPlaybook(v: Omit<Playbook, "id" | "createdAt" | "status">) {
    return db.insert(s.playbooks).values({ ...v, createdAt: now() }).returning().get();
  }
  listPlaybooks(missionId: number) {
    return db.select().from(s.playbooks).where(eq(s.playbooks.missionId, missionId)).orderBy(desc(s.playbooks.id)).all();
  }
  updatePlaybook(id: number, patch: Partial<Playbook>) {
    return db.update(s.playbooks).set(patch).where(eq(s.playbooks.id, id)).returning().get();
  }
  pendingApprovalsForMissions(ids: number[]) {
    if (!ids.length) return [];
    return db.select().from(s.approvals).where(and(inArray(s.approvals.missionId, ids), eq(s.approvals.status, "pending"))).all();
  }
}

export const storage = new Storage();
