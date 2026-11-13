# Deploying Looi Cloud (Hindi/English quick guide)

Goal: Looi runs on **your** server with **your** AI keys, so users only sign up and paste a URL. Free 7-day trial, then Free / Pro (₹999) / Scale (₹2,999) via Razorpay.

## 1. Server (Render, ~10 minutes)

1. Open **https://render.com/deploy?repo=https://github.com/jangidpranshu1989-create/looi** (sign in with GitHub).
2. Render reads `render.yaml`: Docker web service `looi`, region Singapore, plan **Standard (2 GB RAM, ~$25/mo)**, 10 GB disk at `/app/looi-data` (~$2.50/mo).
   Starter (512 MB) is too small for Chromium + FFmpeg video rendering; free instances sleep and lose data.
3. Paste the secret values when Render asks:
   - `GROQ_API_KEY` — https://console.groq.com/keys (use the paid Dev tier once you have users; free limits are low)
   - `NVIDIA_API_KEY` — https://build.nvidia.com (automatic failover)
   - `COMPOSIO_API_KEY` — https://platform.composio.dev (one-click publishing plugins)
   - `PSI_API_KEY` — Google PageSpeed Insights key
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` — dashboard.razorpay.com → Settings → API keys (use Live keys after KYC)
   - `RAZORPAY_WEBHOOK_SECRET` — any strong string; use the same in Razorpay → Webhooks
   - `ADMIN_EMAILS` — your email (gets the unlimited plan)
   - `LOOI_PUBLIC_URL` — leave empty for `*.onrender.com`; set it when you add a custom domain
4. Deploy. Health check: `https://<service>.onrender.com/api/health`.
5. Razorpay → Webhooks → `https://<your-domain>/api/billing/webhook`, events `payment.captured`, `order.paid`, same secret.
6. Custom domain (optional): Render → Settings → Custom Domains → add `looi.yourdomain.com`, set the CNAME, then set `LOOI_PUBLIC_URL`.

Every push to `main` redeploys automatically.

## 2. Android app pointing at your cloud

1. GitHub repo → Settings → Secrets and variables → Actions:
   - Variable `LOOI_CLOUD_URL` = your server URL
   - Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`looi`)
2. Actions → **Android APK** → Run workflow (or push a tag `v1.0.1`). The signed `Looi.apk` and `Looi.aab` appear under Releases.
3. Google Play: upload `Looi.aab` in Play Console (one-time $25). Keep the keystore safe — every update must use the same key.

## 3. Other hosts

Any Docker host with 2 GB+ RAM works (Hetzner/DigitalOcean VPS, Railway, Fly.io, Coolify):

```bash
cp .env.example .env    # fill in
docker build -t looi . && docker run -d --restart=always -p 5000:5000 --env-file .env -v looi-data:/app/looi-data looi
```

Put Caddy or Nginx in front for HTTPS.

## 4. Admin

- `GET /api/admin/stats` (admin token) — users, paid users, revenue, missions.
- `POST /api/admin/grant {email, plan, days}` — give someone Pro/Scale manually.

## 5. Before going big

- Move Groq to a paid tier; free limits get hit quickly with many users.
- Back up `/app/looi-data` (Render disk snapshots are daily).
- Not built yet: password-reset email, Google sign-in, abuse checks for repeated trials.
