import fs from "node:fs";
import type { Channel } from "@shared/schema";
import { mediaPath } from "./analyze";

/** Manual-credential channels were replaced by Composio one-click plugins. Only the URL-based webhook remains. */
export const CHANNEL_TYPES: Record<string, { label: string; fields: { key: string; label: string; secret?: boolean; placeholder?: string }[]; media: string; docs: string; note: string }> = {
  webhook: {
    label: "Webhook (Zapier / Make / n8n)",
    fields: [{ key: "url", label: "Webhook URL", placeholder: "https://hooks.zapier.com/..." }],
    media: "any",
    docs: "https://zapier.com/apps/webhook/integrations",
    note: "Sends JSON with caption, link, media URLs + base64 poster. Route to any app.",
  },
};

export interface PublishInput {
  caption: string;
  link: string;
  videoFile: string;
  posterFile: string;
  publicBase: string;
  title: string;
}
export interface PublishResult {
  externalId: string;
  externalUrl: string;
}

export async function verifyChannel(ch: Channel): Promise<string> {
  const c = JSON.parse(ch.config || "{}");
  if (ch.type === "webhook") {
    const r = await fetch(c.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "looi.test", ts: Date.now() }) });
    if (!r.ok) throw new Error(`Webhook ${r.status}`);
    return `Webhook responded ${r.status}`;
  }
  throw new Error("Unknown channel type");
}

export async function publishTo(ch: Channel, p: PublishInput): Promise<PublishResult> {
  const c = JSON.parse(ch.config || "{}");
  const mediaUrl = (f: string) => (p.publicBase ? `${p.publicBase.replace(/\/$/, "")}/api/public/media/${f}` : "");
  if (ch.type === "webhook") {
    const r = await fetch(c.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "looi.post", title: p.title, caption: p.caption, link: p.link, videoUrl: mediaUrl(p.videoFile), posterUrl: mediaUrl(p.posterFile), posterBase64: fs.readFileSync(mediaPath(p.posterFile)).toString("base64") }),
    });
    if (!r.ok) throw new Error(`Webhook ${r.status}`);
    return { externalId: "", externalUrl: "" };
  }
  throw new Error("Unknown channel type " + ch.type);
}

/** Platform metrics: Looi relies on its own tracked-link clicks (works for every plugin). */
export async function fetchMetrics(_ch: Channel, _ids: string[]): Promise<Record<string, any>> {
  return {};
}

export function captionFor(type: string, captions: Record<string, string>, link: string, hashtags: string[]) {
  const key = type === "facebook" ? "instagram" : type === "discord" || type === "slack" || type === "webhook" ? "generic" : type;
  let cap = captions[key] || captions.generic || captions.x || "";
  const tags = (hashtags || []).slice(0, type === "x" ? 2 : 5).map((h) => (h.startsWith("#") ? h : "#" + h.replace(/\s+/g, ""))).join(" ");
  cap = cap.includes("{link}") ? cap.replace(/\{link\}/g, link) : `${cap}\n\n${link}`;
  if (tags && !cap.includes("#")) cap += `\n\n${tags}`;
  if (type === "x" && cap.length > 280) {
    const short = (captions.x || cap).replace(/\{link\}/g, "").slice(0, 280 - link.length - 4).trim();
    cap = `${short}\n\n${link}`;
  }
  return cap;
}
