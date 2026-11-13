<div align="center">

<img src="native/resources/android/mipmap-xxxhdpi/ic_launcher.png" width="84" alt="Looi" />

# Looi — the 24/7 AI marketing agent

**Paste a URL. Looi markets it until it hits.**

Real site audit · production-grade animated video ads · one-click auto-publishing · re-checks every 2–3 hours and changes strategy on its own.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-d4ff3a.svg?labelColor=0b0b0d)](LICENSE)
[![Deploy to Render](https://img.shields.io/badge/Deploy-Render-d4ff3a.svg?labelColor=0b0b0d)](https://render.com/deploy?repo=https://github.com/jangidpranshu1989-create/looi)
[![Android APK](https://img.shields.io/badge/Android-APK-d4ff3a.svg?labelColor=0b0b0d)](https://github.com/jangidpranshu1989-create/looi/releases/latest)
![Stack](https://img.shields.io/badge/stack-React%20%C2%B7%20Express%20%C2%B7%20SQLite%20%C2%B7%20Capacitor-262626.svg?labelColor=0b0b0d)

<img src="docs/screenshots/landing.png" width="860" alt="Looi landing page" />

</div>

## Why Looi

Most "AI marketing" tools write a caption and stop. Looi takes a **mission**: make your product a hit, and keeps working on it around the clock.

1. **Deep site audit (no fake numbers).** Real Lighthouse on mobile and desktop, Core Web Vitals, SEO, security headers, broken links, tech stack, accessibility and an AI UI/UX review of a real screenshot of your live site.
2. **Production ads from your real product.** Looi captures your actual UI, brand colours and fonts, writes angles and hooks, and renders frame-accurate animated MP4 ads (square, story, landscape) plus posters — in Chromium + FFmpeg, no stock templates.
3. **Auto-publish.** One-click plugins (via [Composio](https://composio.dev)) for X, LinkedIn, Facebook, Instagram, Reddit, Slack, Discord, Telegram, Gmail and 1,000+ apps. Every post carries a tracked link.
4. **24/7 loop.** Every 2–3 hours Looi re-measures your site, reads post metrics and clicks, and decides: scale, iterate, or **pivot** to a new route (new angle, format, channel, Product Hunt / Reddit / Hacker News launch kit, cold email, or site fixes that block conversion).
5. **You stay in control.** Approval mode with a live "running" pill and push notifications, or full autopilot.

| Ads | Site report | Mobile |
|---|---|---|
| <img src="docs/screenshots/ads.png" width="300"/> | <img src="docs/screenshots/report.png" width="300"/> | <img src="docs/screenshots/mobile.png" width="220"/> |

## Use it

- **Looi Cloud** — sign up, paste a URL. Looi AI is included, no API keys. 7-day free trial, then Free / Pro / Scale.
- **Android app** — [download the APK](https://github.com/jangidpranshu1989-create/looi/releases/latest). Runs on Looi Cloud by default; *Advanced → Run on this phone* turns the phone itself into the agent (your own free Groq / NVIDIA NIM key, no server at all).
- **Self-host** — it's open source. One Docker container.

## Plans (Looi Cloud)

| | Trial (7 days) | Free | Pro | Scale |
|---|---|---|---|---|
| Missions | 2 | 1 | 5 | 25 |
| Site audits / 30 days | 4 | 2 | 40 | 200 |
| Video ads / 30 days | 24 | 6 | 200 | 1,000 |
| Re-check interval | 2.5 h | 12 h | 2 h | 1 h |
| Autopilot publishing | yes | – | yes | yes |
| Price | ₹0 | ₹0 | ₹999 / 30 days | ₹2,999 / 30 days |

Payments via Razorpay (UPI, cards, netbanking). No auto-renew.

## Deploy your own Looi Cloud

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/jangidpranshu1989-create/looi)

The blueprint (`render.yaml`) creates a Docker web service with a persistent disk. Fill in:

| Variable | Where to get it | Required |
|---|---|---|
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) | one AI key required |
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) | recommended (failover) |
| `OPENAI_API_KEY` / `LOOI_AI_BASE_URL` + `LOOI_AI_KEY` | any OpenAI-compatible API | optional |
| `COMPOSIO_API_KEY` | [platform.composio.dev](https://platform.composio.dev) | for publishing |
| `PSI_API_KEY` | [Google PageSpeed API](https://developers.google.com/speed/docs/insights/v5/get-started#APIKey) | recommended |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | [dashboard.razorpay.com](https://dashboard.razorpay.com) | for paid plans |
| `ADMIN_EMAILS` | your email (unlimited plan + admin API) | yes |

Razorpay webhook: `https://<your-domain>/api/billing/webhook`, events `payment.captured` and `order.paid`.

### Docker anywhere (VPS, Railway, Fly, Coolify)

```bash
cp .env.example .env   # fill in keys
docker build -t looi .
docker run -d --restart=always -p 5000:5000 --env-file .env -v looi-data:/app/looi-data looi
```

Give it at least 2 GB RAM — real Chromium + FFmpeg rendering is the point.

### Local development

```bash
npm install
npm run dev            # http://localhost:5000  (tables are created automatically)
```

Requires Chromium (`CHROME_PATH` if not auto-detected) and `ffmpeg` on PATH. Without `LOOI_SAAS=1` it runs single-user and you add your own AI key in Settings.

### Android / iOS

```bash
npm run build
cd native && npm install
LOOI_CLOUD_URL=https://your-looi-domain node scripts/sync-web.mjs
npx cap add android && node scripts/patch-android.mjs   # first time only
npx cap sync android && cd android && ./gradlew assembleRelease
```

The GitHub Actions workflow `android.yml` builds and publishes a signed APK on every `v*` tag (set the `LOOI_CLOUD_URL` repository variable and the `ANDROID_KEYSTORE_*` secrets).

## Architecture

| Part | Path | Notes |
|---|---|---|
| Web app (React, Vite, Tailwind, shadcn/ui) | `client/` | Landing, auth, dashboard, missions, approvals, channels, billing, settings. |
| API + agent (Express, SQLite) | `server/` | Auth, plans and quotas (`billing.ts`), scheduler, priority job queue. |
| Agent modules | `server/agent/` | `analyze.ts` audit · `render.ts` MP4 ad renderer · `composio.ts` plugins · `publish.ts` · `llm.ts` Looi AI chain (Groq → NIM → OpenAI-compatible) · `agent.ts` mission loop + strategist. |
| On-device agent | `client/src/local/` | The same agent running inside the phone (IndexedDB, PSI, WebCodecs). |
| Native shell (Capacitor) | `native/` | Android/iOS, OS background runner, local notifications, approvals. |

## Contributing

PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first areas: new ad templates in `server/agent/render.ts`, new launch playbooks, translations.

## License

[AGPL-3.0](LICENSE). You can use, modify and self-host Looi freely. If you run a modified version as a public service, you must publish your changes.
