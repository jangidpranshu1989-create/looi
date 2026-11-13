"use strict";
(() => {
  // client/src/local/core/http.ts
  function withTimeout(p, ms, label = "Request") {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1e3)}s`)), ms);
      p.then(
        (v) => (clearTimeout(t), res(v)),
        (e) => (clearTimeout(t), rej(e))
      );
    });
  }
  var fetchHttp = async (url, o = {}) => {
    var _a, _b;
    const t0 = Date.now();
    const init = { method: o.method || "GET", headers: o.headers || {} };
    if (o.body !== void 0) init.body = o.body;
    const r = await withTimeout(fetch(url, init), o.timeout || 6e4, "HTTP");
    const text = await r.text();
    const headers = {};
    try {
      (_b = (_a = r.headers) == null ? void 0 : _a.forEach) == null ? void 0 : _b.call(_a, (v, k) => headers[k.toLowerCase()] = v);
    } catch {
    }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, url: r.url || url, headers, text, ms: Date.now() - t0 };
  };
  var J = (s, d = {}) => {
    var _a;
    if (s && typeof s === "object") return s;
    try {
      return (_a = JSON.parse(s)) != null ? _a : d;
    } catch {
      return d;
    }
  };

  // client/src/local/core/types.ts
  var DEFAULT_SETTINGS = {
    provider: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: "",
    model: "",
    intervalMinutes: 150,
    defaultMode: "approval",
    psiKey: "",
    brandVoice: "",
    language: "English",
    composioKey: "",
    aiVisuals: false,
    builtinFallback: false,
    publicBaseUrl: ""
  };

  // client/src/local/core/llm.ts
  var PROVIDERS = {
    groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-120b", keyUrl: "https://console.groq.com/keys" },
    nvidia: { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", defaultModel: "openai/gpt-oss-120b", keyUrl: "https://build.nvidia.com/settings" },
    openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini", keyUrl: "https://platform.openai.com/api-keys" },
    custom: { label: "Custom (OpenAI-compatible)", baseUrl: "", defaultModel: "", keyUrl: "" }
  };
  var VISION = /vision|llama-4|maverick|scout|gpt-4o|gpt-4\.1|gpt-5|gemini|qwen.*vl|pixtral|llava|claude|phi-4-multimodal|gemma-3/i;
  function resolved(st) {
    const p = PROVIDERS[st.provider];
    return { base: (st.baseUrl || (p == null ? void 0 : p.baseUrl) || "").replace(/\/$/, ""), model: st.model || (p == null ? void 0 : p.defaultModel) || "", label: (p == null ? void 0 : p.label) || st.provider || "AI" };
  }
  async function chat(http2, st, messages, o = {}) {
    var _a, _b, _c, _d, _e, _f;
    const { base, model, label } = resolved(st);
    if (!st.apiKey) throw new Error("No AI key yet. Add a free Groq or NVIDIA NIM key in Settings \u2192 AI engine.");
    if (!base || !model) throw new Error("AI provider base URL / model not configured");
    const withImage = !!o.imageB64 && VISION.test(model);
    const msgs = messages.map(
      (m, i) => withImage && i === messages.length - 1 && m.role === "user" ? { role: "user", content: [{ type: "text", text: m.content }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${o.imageB64}` } }] } : m
    );
    const body = { model, messages: msgs, max_tokens: (_a = o.maxTokens) != null ? _a : 4e3, temperature: (_b = o.temperature) != null ? _b : 0.7 };
    if (o.json) body.response_format = { type: "json_object" };
    const send = (b) => http2(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${st.apiKey}` }, body: JSON.stringify(b), timeout: 12e4 });
    let r = await send(body);
    if (!r.ok && r.status === 400 && withImage) {
      body.messages = messages;
      r = await send(body);
    }
    if (!r.ok && r.status === 400 && o.json) {
      delete body.response_format;
      r = await send(body);
    }
    if (!r.ok) throw new Error(`${label} ${r.status}: ${r.text.slice(0, 300)}`);
    let j = {};
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error(`${label} returned a non-JSON response`);
    }
    return { text: String((_f = (_e = (_d = (_c = j.choices) == null ? void 0 : _c[0]) == null ? void 0 : _d.message) == null ? void 0 : _e.content) != null ? _f : ""), via: `${label} \xB7 ${model}` };
  }
  function parseJson(text) {
    let t = text.trim().replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      return JSON.parse(t);
    } catch {
      const a = t.indexOf("{");
      const b = t.lastIndexOf("}");
      if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
      throw new Error("AI returned invalid JSON");
    }
  }
  async function chatJson(http2, st, system, user, o = {}) {
    let lastErr;
    for (let i = 0; i < 2; i++) {
      try {
        const r = await chat(http2, st, [{ role: "system", content: system + "\nRespond with ONLY one valid JSON object." }, { role: "user", content: user }], { ...o, json: true });
        return { data: parseJson(r.text), via: r.via };
      } catch (e) {
        lastErr = e;
        if (String((e == null ? void 0 : e.message) || "").match(/40[13]|not configured|No AI key/)) break;
      }
    }
    throw lastErr;
  }

  // client/src/local/core/plugins.ts
  var PLUGINS = [
    { slug: "twitter", name: "X (Twitter)", category: "Social", blurb: "Post ads as tweets with your tracked link.", steps: ["TWITTER_CREATION_OF_A_POST"], hint: "Use `text` only (max 280 chars, keep the link). X API is pay-per-use: about $0.015 per post, $0.20 if it contains a URL." },
    { slug: "linkedin", name: "LinkedIn", category: "Social", blurb: "Share to your LinkedIn feed.", context: ["LINKEDIN_GET_MY_INFO"], steps: ["LINKEDIN_CREATE_LINKED_IN_POST"], hint: "author must be urn:li:person:<id> from the context result (field like sub/id/author_id). visibility PUBLIC, lifecycleState PUBLISHED. Put the caption in commentary. Set contentLandingPage to the link." },
    { slug: "facebook", name: "Facebook Pages", category: "Social", blurb: "Publish to a Page you manage.", context: ["FACEBOOK_GET_USER_PAGES"], steps: ["FACEBOOK_CREATE_POST"], stepsWithImage: ["FACEBOOK_CREATE_PHOTO_POST"], target: { label: "Page name or ID (optional)", placeholder: "Leave empty for your first Page" }, hint: "page_id comes from the context result; pick the page matching target if given, else the first one. Use message for the caption; for link posts set link. For photo posts set url to the poster URL." },
    { slug: "instagram", name: "Instagram", category: "Social", blurb: "Publish poster posts to a Business account.", context: ["INSTAGRAM_GET_USER_INFO"], steps: [], stepsWithImage: ["INSTAGRAM_CREATE_MEDIA_CONTAINER", "INSTAGRAM_CREATE_POST"], needsPublicMedia: true, hint: "Step 1 creates a media container with image_url = poster URL and caption; step 2 publishes it with creation_id = the id returned by step 1. ig_user_id from the context result." },
    { slug: "reddit", name: "Reddit", category: "Community", blurb: "Submit link posts to a subreddit.", steps: ["REDDIT_CREATE_REDDIT_POST"], target: { label: "Subreddit", placeholder: "SideProject", required: true }, hint: "kind 'link', url = the link, title = a non-salesy honest title (no hashtags), subreddit = target without r/." },
    { slug: "slack", name: "Slack", category: "Community", blurb: "Announce in a Slack channel.", steps: ["SLACK_SEND_MESSAGE"], target: { label: "Channel", placeholder: "#launches or C0123ABC", required: true }, hint: "channel = target. Put the caption as markdown_text or text, include the poster URL on its own line if given." },
    { slug: "discordbot", name: "Discord", category: "Community", blurb: "Post to a Discord channel via bot.", steps: ["DISCORDBOT_CREATE_MESSAGE"], target: { label: "Channel ID", placeholder: "123456789012345678", required: true }, hint: "channel_id = target, content = caption (max 2000), add poster URL on its own line so Discord embeds it." },
    { slug: "telegram", name: "Telegram", category: "Community", blurb: "Send to your channel or group.", steps: ["TELEGRAM_SEND_MESSAGE"], stepsWithImage: ["TELEGRAM_SEND_PHOTO"], target: { label: "Chat / channel", placeholder: "@mychannel or -100123\u2026", required: true }, hint: "chat_id = target. For photo: photo = poster URL, caption max 1024 chars. For message: text = caption." },
    { slug: "gmail", name: "Gmail", category: "Outreach", blurb: "Send launch emails to your list.", steps: ["GMAIL_SEND_EMAIL"], target: { label: "Recipients", placeholder: "a@x.com, b@y.com", required: true }, hint: "recipient_email = first address of target, extra_recipients = the rest. subject = headline, body = caption as friendly plain text with the link. If poster URL is given add it at the end." }
  ];
  var pluginDef = (slug) => PLUGINS.find((p) => p.slug === slug);

  // client/src/local/core/composio.ts
  var BASE = "https://backend.composio.dev/api/v3.1";
  var composioUser = (userId) => `looi-${userId}`.slice(0, 120);
  async function call(http2, key, method, path, body) {
    if (!key) throw new Error("Composio is not set up. Add your Composio API key in Plugins.");
    const r = await http2(BASE + path, { method, headers: { "x-api-key": key, ...body ? { "Content-Type": "application/json" } : {} }, body: body ? JSON.stringify(body) : void 0, timeout: 6e4 });
    let j = {};
    try {
      j = r.text ? JSON.parse(r.text) : {};
    } catch {
    }
    if (!r.ok) {
      const e = j == null ? void 0 : j.error;
      throw new Error(`Composio ${r.status}: ${(e == null ? void 0 : e.message) || r.text.slice(0, 200)}${(e == null ? void 0 : e.suggested_fix) ? ` \u2014 ${e.suggested_fix}` : ""}`);
    }
    return j;
  }
  var sessions = /* @__PURE__ */ new Map();
  async function session(http2, key, userId) {
    const k = key.slice(-8) + userId;
    const c = sessions.get(k);
    if (c && Date.now() - c.at < 30 * 6e4) return c.id;
    const j = await call(http2, key, "POST", "/tool_router/session", { user_id: userId });
    sessions.set(k, { id: j.session_id, at: Date.now() });
    return j.session_id;
  }
  async function execute(http2, key, userId, account, tool, args) {
    var _a;
    const sid = await session(http2, key, composioUser(userId));
    const j = await call(http2, key, "POST", `/tool_router/session/${sid}/execute`, { tool_slug: tool, arguments: args, account });
    if (j.result_type && j.result_type !== "completed") throw new Error(`${tool}: ${j.error || j.message || j.result_type}`);
    if (j.error) throw new Error(`${tool}: ${typeof j.error === "string" ? j.error : JSON.stringify(j.error).slice(0, 200)}`);
    return (_a = j.data) != null ? _a : j;
  }
  var schemaCache = /* @__PURE__ */ new Map();
  async function toolSchema(http2, key, slug) {
    if (schemaCache.has(slug)) return schemaCache.get(slug);
    const j = await call(http2, key, "GET", `/tools/${slug}`);
    const s = { slug, description: String(j.description || "").slice(0, 600), input: j.input_parameters || {} };
    schemaCache.set(slug, s);
    return s;
  }
  var pickUrl = (d) => {
    const s = JSON.stringify(d || {});
    const m = s.match(/https?:\/\/(?:www\.)?(?:x|twitter|linkedin|facebook|instagram|reddit|t\.me|discord|slack)[^"\\\s]*/i);
    return m ? m[0] : "";
  };
  var pickId = (d) => {
    var _a, _b, _c;
    const x = (_a = d == null ? void 0 : d.data) != null ? _a : d;
    return String((x == null ? void 0 : x.id) || ((_b = x == null ? void 0 : x.data) == null ? void 0 : _b.id) || (x == null ? void 0 : x.post_id) || (x == null ? void 0 : x.message_id) || ((_c = x == null ? void 0 : x.result) == null ? void 0 : _c.message_id) || (x == null ? void 0 : x.name) || (x == null ? void 0 : x.ts) || "").slice(0, 120);
  };
  async function publishComposio(http2, st, userId, cfg, p) {
    var _a, _b;
    const key = (st.composioKey || "").trim();
    const def = pluginDef(cfg.toolkit);
    const steps = p.posterUrl && ((_a = def == null ? void 0 : def.stepsWithImage) == null ? void 0 : _a.length) ? def.stepsWithImage : ((_b = def == null ? void 0 : def.steps) == null ? void 0 : _b.length) ? def.steps : cfg.publishTool ? [cfg.publishTool] : [];
    if (!steps.length) throw new Error((def == null ? void 0 : def.needsPublicMedia) ? `${def.name} needs a public image URL, which the on-device agent can't host. Download the ad and post it manually, or use a Looi server.` : "No publishing tool configured for this plugin");
    const context = {};
    for (const t of (def == null ? void 0 : def.context) || []) {
      try {
        context[t] = await execute(http2, key, userId, cfg.connectedAccountId, t, {});
      } catch (e) {
        context[t] = { error: String(e.message).slice(0, 200) };
      }
    }
    const prior = {};
    let last = null;
    for (const slug of steps) {
      const schema = await toolSchema(http2, key, slug);
      const { data: args } = await chatJson(
        http2,
        st,
        "You fill API tool arguments for publishing a marketing post. Output ONLY the JSON arguments object that matches the input schema. Never invent IDs \u2014 take them from context/previous results. Omit optional fields you don't need.",
        `Tool: ${slug}
Description: ${schema.description}
Input schema: ${JSON.stringify(schema.input).slice(0, 6e3)}

Post:
- caption: ${JSON.stringify(p.caption)}
- title/headline: ${JSON.stringify(p.title)}
- link (must be included): ${p.link}
- poster image URL: ${p.posterUrl || "(none \u2014 do not attach media)"}
- video URL: ${p.videoUrl || "(none)"}
- user target: ${JSON.stringify(cfg.target || "")}

Platform hint: ${(def == null ? void 0 : def.hint) || "Publish the caption with the link."}

Context results: ${JSON.stringify(context).slice(0, 4e3)}
Previous step results: ${JSON.stringify(prior).slice(0, 3e3)}`,
        { temperature: 0, maxTokens: 1500 }
      );
      last = await execute(http2, key, userId, cfg.connectedAccountId, slug, args);
      prior[slug] = last;
    }
    return { externalId: pickId(last), externalUrl: pickUrl(last) };
  }

  // client/src/local/core/marketing.ts
  var TEMPLATES = ["kinetic", "tour", "problem", "spotlight"];
  var ANGLE_SCHEMA = `{"name": string (angle name e.g. "Speed", "Pain killer", "Social proof"), "hook": string (<=5 words, uppercase-able kicker), "headline": string (<=7 words, punchy), "sub": string (<=16 words), "pain": string (<=6 words, a question), "benefits": [string,string,string] (<=5 words each), "cta": string (<=3 words), "captions": {"x": string (<=200 chars, include {link}), "linkedin": string (3-5 short lines, include {link}), "instagram": string (with emojis, include {link}), "telegram": string (include {link}), "generic": string (include {link})}, "hashtags": string[5]}`;
  function strategistPrompt(st, x) {
    var _a;
    const sys = `You are Looi's autonomous growth strategist. Mission: make this product a hit by any legitimate means. You run every few hours. Analyze real metrics, decide what to do next, and escalate to new routes when traction is weak (new angle \u2192 new format \u2192 new channel \u2192 community launches \u2192 SEO content \u2192 partnerships/influencers \u2192 conversion fixes on the site). Never repeat an angle that underperformed. Be concrete. Language: ${st.language}.`;
    const user = `PRODUCT: ${JSON.stringify(x.product || {})}
CYCLE: ${x.cycle}
SITE NOW: HTTP ${x.status}, response ${x.ttfbMs}ms, mobile perf ${(_a = x.perf) != null ? _a : "n/a"}, LCP ${x.lcp || "n/a"}
RECENT SNAPSHOTS: ${JSON.stringify(x.recent)}
CREATIVES & RESULTS: ${JSON.stringify(x.perCreative.slice(0, 16))}
CLICK TRACKING: not available on-device (links carry UTM tags; read them in the founder's analytics). Treat traction as unknown/low and keep exploring new routes.
CONNECTED AUTO-PUBLISH CHANNELS: ${JSON.stringify(x.connected)}
PLAYBOOKS ALREADY GIVEN: ${JSON.stringify(x.usedPlaybooks)}
SITE ISSUES (top): ${JSON.stringify(x.topIssues)}

Return JSON:
{"assessment": string (2-3 sentences, cite numbers),
 "decision": "scale"|"iterate"|"pivot",
 "reasoning": string,
 "nextAngle": ${ANGLE_SCHEMA},
 "template": "kinetic"|"tour"|"problem"|"spotlight",
 "format": "square"|"story"|"landscape",
 "newRoutes": [{"channel": string, "why": string}] (1-3, routes not yet tried),
 "playbooks": [{"channel": string, "title": string, "content": string (complete, ready to paste)}] (1-2 NEW ones for routes without API),
 "siteFixes": string[] (0-3, only if conversion/perf is blocking),
 "userUpdate": string (short friendly update for the founder, 1-2 sentences)}`;
    return { sys, user };
  }
  function captionFor(type, captions, link, hashtags) {
    const key = type === "facebook" ? "instagram" : type === "discord" || type === "slack" || type === "webhook" ? "generic" : type;
    let cap = captions[key] || captions.generic || captions.x || "";
    const tags = (hashtags || []).slice(0, type === "x" ? 2 : 5).map((h) => h.startsWith("#") ? h : "#" + h.replace(/\s+/g, "")).join(" ");
    cap = cap.includes("{link}") ? cap.replace(/\{link\}/g, link) : `${cap}

${link}`;
    if (tags && !cap.includes("#")) cap += `

${tags}`;
    if (type === "x" && cap.length > 280) {
      const short = (captions.x || cap).replace(/\{link\}/g, "").slice(0, 280 - link.length - 4).trim();
      cap = `${short}

${link}`;
    }
    return cap;
  }
  var capKeyFor = (toolkit) => toolkit === "twitter" ? "x" : toolkit === "discordbot" ? "discord" : toolkit;
  var randCode = () => Math.random().toString(36).slice(2, 9);
  function computeHealth(site, lhM, lhD) {
    var _a, _b, _c, _d;
    const sec = Object.values(site.securityHeaders || {}).filter(Boolean).length / 6;
    const perf = lhM ? lhM.scores.performance * 0.6 + ((_a = lhD == null ? void 0 : lhD.scores.performance) != null ? _a : lhM.scores.performance) * 0.4 : Math.max(0, 100 - (site.ttfbMs || 0) / 20);
    const a11y = (_b = lhM == null ? void 0 : lhM.scores.accessibility) != null ? _b : 70;
    const bp = (_c = lhM == null ? void 0 : lhM.scores.bestPractices) != null ? _c : 70;
    const seo = (_d = lhM == null ? void 0 : lhM.scores.seo) != null ? _d : 70;
    const security = (site.https ? 50 : 0) + sec * 50;
    return Math.round(perf * 0.3 + a11y * 0.2 + bp * 0.15 + seo * 0.2 + security * 0.15);
  }
  function psiUrl(url, strategy, key, categories = ["performance", "accessibility", "best-practices", "seo"]) {
    let q = `url=${encodeURIComponent(url)}&strategy=${strategy}`;
    categories.forEach((c) => q += `&category=${c.toUpperCase().replace("-", "_")}`);
    if (key) q += `&key=${encodeURIComponent(key)}`;
    return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`;
  }

  // native/runner-src/runner.ts
  var kvGet = (k) => {
    try {
      const r = CapacitorKV.get(k);
      return r && typeof r === "object" ? r.value : r;
    } catch {
      return void 0;
    }
  };
  var http = fetchHttp;
  var now = () => Date.now();
  function utm(url, missionId, code, source) {
    const [base, hash] = url.split("#");
    const q = `utm_source=${encodeURIComponent(source)}&utm_medium=social&utm_campaign=looi-${missionId}&utm_content=${code}`;
    return base + (base.includes("?") ? "&" : "?") + q + (hash ? "#" + hash : "");
  }
  function readOutbox() {
    return J(kvGet("looi_outbox"), { ops: [] });
  }
  function push(op) {
    const o = readOutbox();
    o.ops.push(op);
    if (o.ops.length > 400) o.ops = o.ops.slice(-400);
    CapacitorKV.set("looi_outbox", JSON.stringify(o));
  }
  var noteId = 5e3;
  function notify(title, body, kind, missionId) {
    push({ op: "notify", title, body, kind, missionId, ts: now() });
    try {
      CapacitorNotifications.schedule([{ id: noteId++ % 9e4 + 5e3 + Math.floor(Math.random() * 1e3), title, body, extra: { missionId } }]);
    } catch {
    }
  }
  var event = (missionId, kind, title, detail = "") => push({ op: "event", missionId, kind, title, detail, ts: now() });
  async function psiPerf(url, key) {
    var _a, _b, _c, _d, _e;
    try {
      const r = await http(psiUrl(url, "mobile", key, ["performance"]), { timeout: 9e4 });
      if (!r.ok) return {};
      const lhr = J(r.text).lighthouseResult || {};
      return { perf: Math.round(((_c = (_b = (_a = lhr.categories) == null ? void 0 : _a.performance) == null ? void 0 : _b.score) != null ? _c : 0) * 100), lcp: ((_e = (_d = lhr.audits) == null ? void 0 : _d["largest-contentful-paint"]) == null ? void 0 : _e.displayValue) || "" };
    } catch {
      return {};
    }
  }
  async function checkOne(state, m) {
    var _a;
    const st = { ...DEFAULT_SETTINGS, ...state.settings };
    const cycle = (m.cycle || 0) + 1;
    event(m.id, "info", `Cycle ${cycle} started (background)`, "Running on this phone while the app is closed.");
    const r = await http(m.url, { headers: { "User-Agent": "Mozilla/5.0 LooiAgent/1.0" }, timeout: 25e3 }).catch(() => ({ status: 0, ms: 0 }));
    const up = r.status > 0 && r.status < 400;
    if (!up) notify(`Site issue \xB7 ${m.name}`, `Your site returned ${r.status ? "HTTP " + r.status : "no response"}. New ads paused until it's back.`, "error", m.id);
    const { perf, lcp } = await psiPerf(m.url, st.psiKey);
    const connected = (state.channels || []).filter((c) => c.status === "connected").map((c) => c.type === "composio" ? c.config.toolkit : c.type);
    const sp = strategistPrompt(st, { product: m.product, cycle, status: r.status, ttfbMs: r.ms, perf, lcp, recent: m.recent || [], perCreative: m.perCreative || [], connected, usedPlaybooks: m.usedPlaybooks || [], topIssues: m.topIssues || [] });
    const { data: plan, via } = await chatJson(http, st, sp.sys, sp.user, { maxTokens: 5e3, temperature: 0.8 });
    event(m.id, "decision", `Strategist: ${String(plan.decision || "iterate").toUpperCase()} \u2014 ${((_a = plan.nextAngle) == null ? void 0 : _a.name) || "new angle"}`, `${plan.assessment || ""}
${plan.reasoning || ""}`);
    for (const pb of (plan.playbooks || []).slice(0, 2)) push({ op: "playbook", missionId: m.id, cycle, channel: pb.channel, title: pb.title, content: pb.content, status: "ready", createdAt: now() });
    const posts = [];
    if (up && plan.nextAngle) {
      const angle = plan.nextAngle;
      const tpl = TEMPLATES.includes(plan.template) ? plan.template : "kinetic";
      const fmt = ["square", "story", "landscape"].includes(plan.format) ? plan.format : "square";
      const channels = (state.channels || []).filter((c) => (m.channelIds || []).includes(c.id) && c.status === "connected" && c.type === "composio");
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
            event(m.id, "success", `Published to ${ch.name}`, `\u201C${angle.headline}\u201D \xB7 caption + tracked link`);
          } catch (e) {
            const msg = String(e.message).slice(0, 400);
            posts.push({ channelId: ch.id, channelType: tk, linkCode: code, externalId: "", externalUrl: "", status: "failed", error: msg, publishedAt: 0 });
            event(m.id, "error", `Publish to ${ch.name} failed`, msg);
          }
        }
      }
      push({ op: "creative", missionId: m.id, cycle, angle: angle.name || "", template: tpl, format: fmt, copy: { ...angle, _reason: plan.reasoning || "", _published: posts.some((p) => p.status === "published") }, posts, createdAt: now() });
    }
    const health = computeHealth({ ...m.healthSite || {}, ttfbMs: r.ms }, perf !== void 0 ? { scores: { performance: perf, ...m.lsScores || { accessibility: 70, bestPractices: 70, seo: 70 } } } : void 0);
    push({ op: "snapshot", missionId: m.id, cycle, ts: now(), data: { health, perf, ttfb: r.ms, clicks: 0, decision: plan.decision, background: true } });
    const nextCheckAt = now() + (st.intervalMinutes || 150) * 6e4;
    push({ op: "mission", id: m.id, patch: { cycle, lastCheckAt: now(), nextCheckAt, healthScore: health, strategy: { ...plan, via, cycle, at: now() }, stage: "Monitoring" } });
    m.cycle = cycle;
    m.nextCheckAt = nextCheckAt;
    const approvalNote = m.mode !== "autopilot" && plan.nextAngle && up ? " New ad ready \u2014 open Looi to approve." : "";
    notify(`Cycle ${cycle} update \xB7 ${m.name}`, (plan.userUpdate || plan.assessment || "Check complete.") + approvalNote, approvalNote ? "approval" : "update", m.id);
  }
  async function deviceRun() {
    var _a;
    const state = J(kvGet("looi_state"), null);
    if (!((_a = state == null ? void 0 : state.settings) == null ? void 0 : _a.apiKey)) return;
    const due = (state.missions || []).filter((m) => m.status === "active" && (m.nextCheckAt || 0) <= now()).slice(0, 2);
    for (const m of due) {
      try {
        await checkOne(state, m);
      } catch (e) {
        const msg = String(e.message).slice(0, 300);
        event(m.id, "error", "Background check failed", msg);
        m.nextCheckAt = now() + 30 * 6e4;
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
    const notes = [];
    if (n && n.id > lastSeen) {
      notes.push({ id: 1e3 + n.id % 1e5, title: n.title, body: n.body || "" });
      CapacitorKV.set("lastNotif", String(n.id));
    }
    const pending = (live.approvals || []).length;
    const lastPending = Number(kvGet("lastPending") || 0);
    if (pending > lastPending) notes.push({ id: 7, title: "Approval needed", body: `${pending} ad batch${pending > 1 ? "es" : ""} waiting \u2014 tap to review.` });
    CapacitorKV.set("lastPending", String(pending));
    if (notes.length) CapacitorNotifications.schedule(notes);
  }
  addEventListener("looiCheck", async (resolve, reject, args) => {
    var _a;
    try {
      if (args && args.server) {
        CapacitorKV.set("mode", "server");
        CapacitorKV.set("server", args.server);
        CapacitorKV.set("device", args.device || "");
        return resolve();
      }
      let active = false;
      try {
        active = !!((_a = CapacitorApp == null ? void 0 : CapacitorApp.getState()) == null ? void 0 : _a.isActive);
      } catch {
      }
      if (active) return resolve();
      if (kvGet("mode") === "server") await serverRun();
      else await deviceRun();
      resolve();
    } catch (e) {
      reject(e);
    }
  });
  addEventListener("sync", (resolve, reject, args) => {
    try {
      CapacitorKV.set("mode", "device");
      if (args == null ? void 0 : args.state) CapacitorKV.set("looi_state", typeof args.state === "string" ? args.state : JSON.stringify(args.state));
      resolve();
    } catch (e) {
      reject(e);
    }
  });
  addEventListener("pull", (resolve, reject) => {
    try {
      const o = readOutbox();
      CapacitorKV.set("looi_outbox", JSON.stringify({ ops: [] }));
      resolve({ ops: JSON.stringify(o.ops) });
    } catch (e) {
      reject(e);
    }
  });
})();
