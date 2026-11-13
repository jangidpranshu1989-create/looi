# Looi — the 24/7 marketing agent

Paste a URL. Looi audits the site for real, produces animated video ads from the live product, publishes them to your channels, and re-checks every 2–3 hours — changing angle, format or route on its own when traction is weak.

## What runs where

| Part | Path | Notes |
|---|---|---|
| Web app (React + Vite) | `client/` | Landing, dashboard, mission detail, approvals, channels, settings. Hash routing. |
| API + agent (Express) | `server/` | Routes, SQLite storage, scheduler, job queue. |
| Agent modules | `server/agent/` | `analyze.ts` (HTTP/DOM/SEO/security + Playwright render + Lighthouse), `render.ts` (frame-accurate MP4 ad renderer via Chromium + FFmpeg), `composio.ts` (one-click plugins via Composio), `publish.ts` (webhook + captions), `llm.ts` (Groq / NVIDIA NIM / OpenAI / custom + built-in fallback), `agent.ts` (launch pipeline, re-check cycle, strategist, approvals, live state). |
| Native app (Capacitor 7) | `native/` | Android + iOS shell, server-URL setup, local notifications, OS background runner polling `/api/live`. |

## Run locally

```bash
npm install
npx drizzle-kit push      # creates data.db
npm run dev               # http://localhost:5000
```

Requires Chromium (set `CHROME_PATH` if not auto-detected) and `ffmpeg` on PATH.

## Self-host 24/7 (Docker)

```bash
docker build -t looi .
docker run -d --restart=always -p 5000:5000 -v looi-data:/app/looi-data looi
```

Then in **Settings → Tracking & data** set the public URL of the server so posts carry tracked `/r/<code>` links and Instagram can fetch video files.

## AI engine

Settings → AI engine. Any OpenAI-compatible endpoint:

- Groq — `https://api.groq.com/openai/v1` (default model `openai/gpt-oss-120b`)
- NVIDIA NIM — `https://integrate.api.nvidia.com/v1`
- OpenAI — `https://api.openai.com/v1`
- Custom — OpenRouter, Together, vLLM, Ollama, etc.

The built-in engine only exists on the hosted preview. On a self-hosted server, set your own provider key.

## Native app

```bash
cd native
npm install
npx cap add android        # once
npm run android:apk        # needs JDK 21 + Android SDK
npx cap add ios && npm run ios   # macOS + Xcode
```

Or push to GitHub: `.github/workflows/android.yml` builds a debug APK artifact.

On first launch the app asks for your Looi server URL. Each device gets its own private workspace (`X-Looi-Device` header). Background checks run through `@capacitor/background-runner` (OS minimum ~15 min) and raise local notifications for approvals and cycle updates.

## Plugins (one-click connect)

Publishing runs on [Composio](https://docs.composio.dev): users click **Connect**, sign in on the platform's own OAuth page, and Composio stores and refreshes the tokens. Looi never sees passwords or tokens.

- Set `COMPOSIO_API_KEY` on the server (every user gets one-click connect with no setup), or paste a key in **Settings → Plugins**.
- Curated marketing plugins: X, LinkedIn, Facebook Pages, Instagram, Reddit, Slack, Discord, Telegram, Gmail. Each has a tuned publish recipe (e.g. LinkedIn fetches your person URN first; Instagram creates a media container, then publishes).
- **More apps:** search 1,000+ Composio toolkits. For uncurated apps the agent picks the publishing tool once and fills the arguments from the tool's JSON schema.
- Arguments are filled by the configured LLM from each tool's live schema (`GET /api/v3.1/tools/{slug}`), executed through a session (`POST /api/v3.1/tool_router/session/{id}/execute`).
- Image posts (Instagram, Facebook photo, Telegram photo) need **Public server URL** so the platform can fetch the poster.
- An advanced webhook (Zapier / Make / n8n) remains for anything else.
