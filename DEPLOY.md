# Deploying Looi — 100% free (recommended)

Looi Free costs **₹0**: Cloudflare Workers **free plan** (no card) + GitHub Actions. The agent runs on each user's phone (Android app, background worker) or in their browser tab. Your free Cloudflare Worker gives every user, without any key:

- **Looi AI** — your NVIDIA NIM key, instant switch to Groq on any error/timeout (NIM skipped for 3 min).
- **One-click plugins** — your Composio key, every device isolated as its own Composio user (`looi-free-<device>`).
- **Public media links** — posters/videos stored 7 days in Workers KV, so Instagram/Facebook can fetch them.
- **Site fetch proxy** — lets the browser version audit any URL (private/internal addresses blocked).
- The web app itself.

```
Phone (APK, 24/7 background) / Browser tab  ── runs the agent, renders ads, audits the site
      │
Cloudflare Worker "looi" (free) ── /relay/ai  /relay/composio  /relay/media  /relay/fetch  + web app
      │
Workers KV "looi-media" (7-day public links)
```

## 1. Cloudflare (free, ~5 minutes)

1. Sign up at https://dash.cloudflare.com (Free plan, no card). Open **Workers & Pages** once so your `*.workers.dev` subdomain is created.
2. **API token**: My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** → add **Account · Workers KV Storage · Edit** → Create. Copy it.
3. **Account ID**: Workers & Pages overview, right sidebar.

## 2. GitHub secrets

https://github.com/jangidpranshu1989-create/looi/settings/secrets/actions → New repository secret:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token from 1.2 |
| `CLOUDFLARE_ACCOUNT_ID` | account ID from 1.3 |
| `NVIDIA_API_KEY` | free key at https://build.nvidia.com |
| `GROQ_API_KEY` | free key at https://console.groq.com/keys |
| `COMPOSIO_API_KEY` | free key at https://platform.composio.dev → Settings → API Keys |

## 3. Deploy

Actions → **Deploy to Cloudflare (Free)** → Run workflow (it also runs on every push to `main`). It builds the web app, creates the KV namespace, uploads your keys as encrypted secrets, deploys, and then **builds a new signed APK pointing at your Worker** (Releases → latest → `Looi.apk`).

Your app: `https://looi.<your-subdomain>.workers.dev` (printed in the run summary). Check `/relay/status` — every value should be `true`.

## 4. Free-plan limits (be honest with users)

| Limit | Value | What it means |
|---|---|---|
| Worker requests | 100,000 / day | plenty for hundreds of users |
| KV writes | 1,000 / day | ≈ 1,000 media uploads/day across all users |
| Looi AI per device | 300 calls / day (`LOOI_DAILY_AI`) | best-effort cap, protects your NIM/Groq quota |
| Media uploads per device | 40 / day (`LOOI_DAILY_MEDIA`) | |
| NVIDIA NIM / Groq free tiers | provider rate limits | when both are exhausted, the app falls back to its rules engine; users can paste their own key in Settings |

- **24/7** means the phone keeps working: Android wakes Looi in the background (~every 15 min), and each mission is re-checked every 2–3 h. A browser tab only works while open.
- Background publishing (phone locked) posts text + link; posts with the poster image happen when the app is open (it uploads the image to the free relay first).
- No accounts, no database server: every user's missions live on their own device.

---

# Optional: Looi Cloud (paid, ~$50/month)

Only if you later want server-side accounts, plans and UPI billing. Workflow: **Deploy Looi Cloud (paid, Containers)** (manual run only).

Goal: Looi runs on **your** Cloudflare account with **your** AI keys, so users only sign up and paste a URL. 7-day free trial, then Free / Pro (₹999) / Scale (₹2,999), paid by UPI.

### How it runs

```
Browser / Android app
      │
Cloudflare Worker (edge) ── static web app (Workers Static Assets)
      │                 └── /api/media/* served straight from R2
      ▼
Cloudflare Container "LooiServer" (1 always-on instance, standard-2: 1 vCPU · 6 GiB · 12 GB)
  Node API · 24/7 agent loop (re-check every 2–3 h) · Chromium audits · FFmpeg MP4 ads
      │
R2 bucket "looi-data"  ── SQLite snapshot every 60 s + daily copies · all media
Cron every 2 min ── keeps the agent awake, restarts it after host maintenance
```

Container disks are temporary, so the DB is restored from R2 on every boot (`script/r2-restore.mjs`) and flushed on shutdown. At most ~60 s of data can be lost on a hard crash.

### Cloud 1. Cloudflare (one time, ~10 minutes)

1. Sign up at https://dash.cloudflare.com and buy **Workers Paid** ($5/month) — Containers need it.
2. **API token**: My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** → add permissions **Account · Workers R2 Storage · Edit** and **Account · Containers · Edit** → Create. Copy the token.
3. **Account ID**: Workers & Pages overview, right sidebar.

### Cloud 2. GitHub secrets

https://github.com/jangidpranshu1989-create/looi/settings/secrets/actions → New repository secret:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token from step 1.2 |
| `CLOUDFLARE_ACCOUNT_ID` | account ID from step 1.3 |
| `NVIDIA_API_KEY` | https://build.nvidia.com (primary brain) |
| `GROQ_API_KEY` | https://console.groq.com/keys (instant failover — use the paid tier once you have users) |
| `COMPOSIO_API_KEY` | https://platform.composio.dev (one-click publishing plugins) |
| `PSI_API_KEY` | Google PageSpeed Insights key |
| `ADMIN_EMAILS` | `jangid.pranshu1989@gmail.com,lumora.web.co@gmail.com` |
| `LOOI_PUBLIC_URL` | optional — only when you add a custom domain |

### Cloud 3. Deploy

Actions → **Deploy Looi Cloud (paid, Containers)** → Run workflow. It builds the web app and the Docker image, creates the R2 bucket on first run, uploads secrets and deploys.

Your app: `https://looi.<your-subdomain>.workers.dev` (shown at the end of the log). Health: `/api/health`. The first boot takes ~1 minute.

**Immediately sign up with an `ADMIN_EMAILS` address** — admins get the unlimited plan and the payment verification screen.

Custom domain: Workers & Pages → looi → Settings → Domains & Routes → add `looi.yourdomain.com`.

### Cloud 4. Payments (UPI + UTR)

1. User picks Pro/Scale → Looi creates an order with a unique amount (e.g. ₹999.37) and reference `LOOI…`.
2. Mobile: **Pay with UPI app** deep link (`upi://pay?pa=8529418454@fam…`). Desktop: QR code. UPI ID / amount can be copied.
3. User pastes the 12-digit **UTR** from their UPI app. Duplicate UTRs are refused. The plan unlocks **provisionally for 48 h** (`LOOI_PROVISIONAL_HOURS`); accounts that had a UTR rejected before must wait.
4. You open **/app/admin**, match amount + UTR in your FamPay history and press **Approve** (30 days activated) or **Reject** (plan reverts). Both sides get notifications.

Important: personal (P2P) UPI IDs have no API, so no software can verify a UTR automatically — the admin check is the verification. Some UPI apps block P2P links with a pre-filled amount, and personal IDs have daily limits. For volume, get a free **UPI merchant / business QR** (Paytm Business, PhonePe Business, BharatPe) and set `LOOI_UPI_ID` to it in `cloudflare/wrangler.jsonc`.

Support contact shown in the app: jangid.pranshu1989@gmail.com · WhatsApp +91 85294 18454.

### Cloud 5. AI failover

Order `LOOI_AI_ORDER=custom,nvidia,groq,openai`. NVIDIA NIM answers first; any error, rate limit, timeout (`LOOI_NIM_TIMEOUT_MS`, 45 s) or empty reply switches to Groq in the same request, and NIM is skipped for 3 minutes (`LOOI_AI_COOLDOWN_MS`) so users never wait on a broken provider. If every key fails, the built-in rules engine still produces copy.

### Cloud 6. Cost (always-on, 24/7)

| Item | Monthly |
|---|---|
| Workers Paid | $5 |
| Container standard-2 (6 GiB memory always on, CPU billed by actual use) | ~$45–55 |
| R2 (first 10 GB free) | ~$0–2 |
| **Total** | **~$50–60** |

To save ~40% use `"instance_type": "standard-1"` (½ vCPU, 4 GiB) in `cloudflare/wrangler.jsonc` — fine for a few users, slower video renders. Pricing: https://developers.cloudflare.com/containers/platform/pricing/

### Cloud 7. Android app pointing at your cloud

1. Repo → Settings → Secrets and variables → Actions → **Variables** → `LOOI_CLOUD_URL` = your workers.dev URL.
2. Actions → **Android APK** → Run workflow. The signed `Looi.apk` and `Looi.aab` appear under Releases (the web app's Download page links to the latest one).
3. Google Play: upload `Looi.aab` (one-time $25). Keep the keystore safe — every update must use the same key.

### Cloud 8. Other hosts

Any Docker host with 2 GB+ RAM works (VPS, Railway, Fly.io, Coolify):

```bash
cp .env.example .env    # fill in
docker build -t looi . && docker run -d --restart=always -p 5000:5000 --env-file .env -v looi-data:/app/looi-data looi
```

### Cloud 9. Before going big

- Move Groq to a paid tier; free limits get hit quickly.
- R2 keeps daily DB copies under `db/daily/` — download one now and then.
- Not built yet: password-reset email, email verification, Google sign-in.
