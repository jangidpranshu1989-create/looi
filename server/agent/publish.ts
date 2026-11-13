import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Channel } from "@shared/schema";
import { mediaPath } from "./analyze";

export const CHANNEL_TYPES: Record<string, { label: string; fields: { key: string; label: string; secret?: boolean; placeholder?: string }[]; media: string; docs: string; note: string }> = {
  telegram: {
    label: "Telegram",
    fields: [
      { key: "botToken", label: "Bot token", secret: true, placeholder: "123456:ABC-DEF..." },
      { key: "chatId", label: "Channel / chat ID", placeholder: "@mychannel or -100123..." },
    ],
    media: "video",
    docs: "https://core.telegram.org/bots/api#sendvideo",
    note: "Create a bot with @BotFather, add it as admin to your channel.",
  },
  discord: {
    label: "Discord",
    fields: [{ key: "webhookUrl", label: "Webhook URL", secret: true, placeholder: "https://discord.com/api/webhooks/..." }],
    media: "video",
    docs: "https://discord.com/developers/docs/resources/webhook#execute-webhook",
    note: "Server Settings → Integrations → Webhooks → New webhook.",
  },
  slack: {
    label: "Slack",
    fields: [{ key: "webhookUrl", label: "Incoming webhook URL", secret: true, placeholder: "https://hooks.slack.com/services/..." }],
    media: "link",
    docs: "https://api.slack.com/messaging/webhooks",
    note: "Posts caption + tracked link (+ media link when public URL is set).",
  },
  x: {
    label: "X (Twitter)",
    fields: [
      { key: "apiKey", label: "API key", secret: true },
      { key: "apiSecret", label: "API key secret", secret: true },
      { key: "accessToken", label: "Access token", secret: true },
      { key: "accessSecret", label: "Access token secret", secret: true },
    ],
    media: "image",
    docs: "https://docs.x.com/x-api/posts/create-post",
    note: "X API is pay-per-use: ~$0.015/post, ~$0.20 for posts containing a URL.",
  },
  linkedin: {
    label: "LinkedIn",
    fields: [
      { key: "accessToken", label: "Access token (w_member_social)", secret: true },
      { key: "authorUrn", label: "Author URN", placeholder: "urn:li:person:xxxx or urn:li:organization:123" },
    ],
    media: "image",
    docs: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api",
    note: "Uses the Posts API with image upload.",
  },
  facebook: {
    label: "Facebook Page",
    fields: [
      { key: "pageId", label: "Page ID" },
      { key: "pageToken", label: "Page access token", secret: true },
    ],
    media: "video",
    docs: "https://developers.facebook.com/docs/video-api/guides/publishing",
    note: "Needs pages_manage_posts permission.",
  },
  instagram: {
    label: "Instagram (Reels)",
    fields: [
      { key: "igUserId", label: "IG business user ID" },
      { key: "accessToken", label: "Access token", secret: true },
    ],
    media: "video",
    docs: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    note: "Requires Looi public URL (Settings) so Instagram can fetch the video.",
  },
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

const file = (name: string) => new Blob([fs.readFileSync(mediaPath(name))], { type: name.endsWith(".mp4") ? "video/mp4" : "image/jpeg" });

async function okJson(r: Response, label: string) {
  const t = await r.text();
  let j: any = {};
  try {
    j = JSON.parse(t);
  } catch {}
  if (!r.ok) throw new Error(`${label} ${r.status}: ${t.slice(0, 300)}`);
  return j;
}

// ---------- OAuth 1.0a for X
function pct(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function oauthHeader(method: string, url: string, c: any, extra: Record<string, string> = {}) {
  const o: Record<string, string> = {
    oauth_consumer_key: c.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: c.accessToken,
    oauth_version: "1.0",
  };
  const u = new URL(url);
  const params: [string, string][] = [...Object.entries(o), ...Object.entries(extra), ...[...u.searchParams.entries()]];
  const norm = params.map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const base = [method.toUpperCase(), pct(u.origin + u.pathname), pct(norm)].join("&");
  const key = `${pct(c.apiSecret)}&${pct(c.accessSecret)}`;
  o.oauth_signature = crypto.createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.entries(o).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}

export async function verifyChannel(ch: Channel): Promise<string> {
  const c = JSON.parse(ch.config || "{}");
  switch (ch.type) {
    case "telegram": {
      const me = await okJson(await fetch(`https://api.telegram.org/bot${c.botToken}/getMe`), "Telegram");
      const chat = await okJson(await fetch(`https://api.telegram.org/bot${c.botToken}/getChat?chat_id=${encodeURIComponent(c.chatId)}`), "Telegram chat");
      return `@${me.result.username} → ${chat.result.title || chat.result.username || c.chatId}`;
    }
    case "discord": {
      const j = await okJson(await fetch(c.webhookUrl), "Discord");
      return `Webhook “${j.name}”`;
    }
    case "slack": {
      if (!/^https:\/\/hooks\.slack\.com\//.test(c.webhookUrl)) throw new Error("Not a Slack incoming webhook URL");
      return "Webhook URL looks valid (Slack verifies on first post)";
    }
    case "x": {
      const url = "https://api.x.com/2/users/me";
      const j = await okJson(await fetch(url, { headers: { Authorization: oauthHeader("GET", url, c) } }), "X");
      return `@${j.data?.username}`;
    }
    case "linkedin": {
      const j = await okJson(await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${c.accessToken}` } }), "LinkedIn");
      return j.name || "LinkedIn member";
    }
    case "facebook": {
      const j = await okJson(await fetch(`https://graph.facebook.com/v23.0/${c.pageId}?fields=name&access_token=${encodeURIComponent(c.pageToken)}`), "Facebook");
      return `Page “${j.name}”`;
    }
    case "instagram": {
      const j = await okJson(await fetch(`https://graph.facebook.com/v23.0/${c.igUserId}?fields=username&access_token=${encodeURIComponent(c.accessToken)}`), "Instagram");
      return `@${j.username}`;
    }
    case "webhook": {
      const r = await fetch(c.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "looi.test", ts: Date.now() }) });
      if (!r.ok) throw new Error(`Webhook ${r.status}`);
      return `Webhook responded ${r.status}`;
    }
  }
  throw new Error("Unknown channel type");
}

export async function publishTo(ch: Channel, p: PublishInput): Promise<PublishResult> {
  const c = JSON.parse(ch.config || "{}");
  const mediaUrl = (f: string) => (p.publicBase ? `${p.publicBase.replace(/\/$/, "")}/api/public/media/${f}` : "");
  switch (ch.type) {
    case "telegram": {
      const fd = new FormData();
      fd.append("chat_id", c.chatId);
      fd.append("caption", p.caption.slice(0, 1024));
      fd.append("video", file(p.videoFile), path.basename(p.videoFile));
      fd.append("supports_streaming", "true");
      fd.append("thumbnail", file(p.posterFile), "thumb.jpg");
      const j = await okJson(await fetch(`https://api.telegram.org/bot${c.botToken}/sendVideo`, { method: "POST", body: fd }), "Telegram");
      const chat = j.result.chat;
      return { externalId: String(j.result.message_id), externalUrl: chat.username ? `https://t.me/${chat.username}/${j.result.message_id}` : "" };
    }
    case "discord": {
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify({ content: p.caption.slice(0, 2000) }));
      fd.append("files[0]", file(p.videoFile), "ad.mp4");
      const j = await okJson(await fetch(c.webhookUrl + (c.webhookUrl.includes("?") ? "&" : "?") + "wait=true", { method: "POST", body: fd }), "Discord");
      return { externalId: j.id, externalUrl: j.guild_id ? `https://discord.com/channels/${j.guild_id}/${j.channel_id}/${j.id}` : "" };
    }
    case "slack": {
      const v = mediaUrl(p.videoFile);
      const r = await fetch(c.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: p.caption + (v ? `\n🎬 ${v}` : "") }) });
      if (!r.ok) throw new Error(`Slack ${r.status}: ${await r.text()}`);
      return { externalId: "", externalUrl: "" };
    }
    case "x": {
      let mediaId = "";
      try {
        const up = "https://api.x.com/2/media/upload";
        const fd = new FormData();
        fd.append("media", file(p.posterFile), "ad.jpg");
        fd.append("media_category", "tweet_image");
        const j = await okJson(await fetch(up, { method: "POST", headers: { Authorization: oauthHeader("POST", up, c) }, body: fd }), "X media");
        mediaId = j.data?.id || j.media_id_string || "";
      } catch {
        mediaId = "";
      }
      const url = "https://api.x.com/2/tweets";
      const body: any = { text: p.caption.slice(0, 280) };
      if (mediaId) body.media = { media_ids: [mediaId] };
      const j = await okJson(await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url, c), "Content-Type": "application/json" }, body: JSON.stringify(body) }), "X");
      return { externalId: j.data.id, externalUrl: `https://x.com/i/status/${j.data.id}` };
    }
    case "linkedin": {
      const H = { Authorization: `Bearer ${c.accessToken}`, "LinkedIn-Version": "202510", "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" };
      let imageUrn = "";
      try {
        const init = await okJson(await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", { method: "POST", headers: H, body: JSON.stringify({ initializeUploadRequest: { owner: c.authorUrn } }) }), "LinkedIn upload");
        await fetch(init.value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${c.accessToken}` }, body: fs.readFileSync(mediaPath(p.posterFile)) });
        imageUrn = init.value.image;
      } catch {}
      const body: any = { author: c.authorUrn, commentary: p.caption.slice(0, 2900), visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false };
      if (imageUrn) body.content = { media: { id: imageUrn, title: p.title } };
      const r = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", headers: H, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`LinkedIn ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const id = r.headers.get("x-restli-id") || "";
      return { externalId: id, externalUrl: id ? `https://www.linkedin.com/feed/update/${id}` : "" };
    }
    case "facebook": {
      const fd = new FormData();
      fd.append("access_token", c.pageToken);
      fd.append("description", p.caption);
      fd.append("title", p.title);
      fd.append("source", file(p.videoFile), "ad.mp4");
      const j = await okJson(await fetch(`https://graph-video.facebook.com/v23.0/${c.pageId}/videos`, { method: "POST", body: fd }), "Facebook");
      return { externalId: j.id, externalUrl: `https://www.facebook.com/${j.id}` };
    }
    case "instagram": {
      const v = mediaUrl(p.videoFile);
      if (!v) throw new Error("Instagram needs a public Looi URL (Settings → Public URL) to fetch the video");
      const base = `https://graph.facebook.com/v23.0/${c.igUserId}`;
      const cr = await okJson(await fetch(`${base}/media`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_type: "REELS", video_url: v, caption: p.caption.slice(0, 2200), access_token: c.accessToken }) }), "Instagram");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const st = await okJson(await fetch(`https://graph.facebook.com/v23.0/${cr.id}?fields=status_code&access_token=${encodeURIComponent(c.accessToken)}`), "Instagram status");
        if (st.status_code === "FINISHED") break;
        if (st.status_code === "ERROR") throw new Error("Instagram processing failed");
      }
      const pub = await okJson(await fetch(`${base}/media_publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creation_id: cr.id, access_token: c.accessToken }) }), "Instagram publish");
      return { externalId: pub.id, externalUrl: "" };
    }
    case "webhook": {
      const r = await fetch(c.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "looi.post",
          title: p.title,
          caption: p.caption,
          link: p.link,
          videoUrl: mediaUrl(p.videoFile),
          posterUrl: mediaUrl(p.posterFile),
          posterBase64: fs.readFileSync(mediaPath(p.posterFile)).toString("base64"),
        }),
      });
      if (!r.ok) throw new Error(`Webhook ${r.status}`);
      return { externalId: "", externalUrl: "" };
    }
  }
  throw new Error("Unknown channel type " + ch.type);
}

/** Pull platform-native metrics where the API allows it. */
export async function fetchMetrics(ch: Channel, externalIds: string[]): Promise<Record<string, any>> {
  const c = JSON.parse(ch.config || "{}");
  const out: Record<string, any> = {};
  if (!externalIds.length) return out;
  try {
    if (ch.type === "x") {
      const url = `https://api.x.com/2/tweets?ids=${externalIds.slice(0, 100).join(",")}&tweet.fields=public_metrics`;
      const j = await okJson(await fetch(url, { headers: { Authorization: oauthHeader("GET", url, c) } }), "X metrics");
      for (const t of j.data || []) out[t.id] = t.public_metrics;
    } else if (ch.type === "facebook") {
      for (const id of externalIds.slice(0, 20)) {
        const j = await okJson(await fetch(`https://graph.facebook.com/v23.0/${id}?fields=views,likes.summary(true),comments.summary(true)&access_token=${encodeURIComponent(c.pageToken)}`), "FB metrics");
        out[id] = { views: j.views, likes: j.likes?.summary?.total_count, comments: j.comments?.summary?.total_count };
      }
    }
  } catch (e) {
    out.__error = String((e as Error).message);
  }
  return out;
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
