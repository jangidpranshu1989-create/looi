# Deploying Looi

Looi ships in two shapes. Pick one or both.

| | Android app (on-device) | Web app (server) |
|---|---|---|
| Where the agent runs | On the user's phone | On your server, 24/7 |
| Server needed | No | Yes (Docker) |
| Keys | Each user adds their own (Groq / NVIDIA NIM, Composio, PageSpeed) | You can set shared keys via env |
| Background | Android WorkManager, about every 15 min at most often | Always on |
| Click tracking | UTM tags only | Built-in redirect tracker |
| Instagram / image posts | Not possible (needs a public image URL) | Yes, with `LOOI_PUBLIC_URL` |

## 1. Android app: no server

Files: `Looi.apk` (signed release, direct install) and `Looi.aab` (for Google Play).

### Option A: direct download (free, fastest)
1. Upload `Looi.apk` to GitHub Releases, your website, or Google Drive.
2. Users open the link on Android and allow "Install unknown apps".
3. On first launch they pick **Run on this phone**, then add:
   - an AI key: Groq (https://console.groq.com/keys) or NVIDIA NIM (https://build.nvidia.com)
   - a Composio key for one-click publishing (https://platform.composio.dev)
   - a Google PageSpeed key, recommended because the shared keyless quota is often used up (https://developers.google.com/speed/docs/insights/v5/get-started#APIKey)
4. Ask users to turn off battery optimization for Looi (Settings → Apps → Looi → Battery → Unrestricted) so background checks aren't delayed.

### Option B: Google Play
1. Create a Play Console account: $25 one-time fee.
2. New personal accounts must run a closed test with 12+ testers opted in for 14 continuous days before production access: https://support.google.com/googleplay/android-developer/answer/14151465
3. Upload `Looi.aab`. Since Aug 31, 2026 Play requires new apps and updates to target API 36 (Android 16), which Looi does: https://support.google.com/googleplay/android-developer/answer/11926878
4. Declare in the Data Safety form that keys and data are stored on the device and sent only to the providers the user configures.

### Signing key: keep it safe
`looi-release.jks` plus its password (in `KEYSTORE-PASSWORD.txt`) sign every update. If you lose them you can't update the app for existing users. Back them up offline and never commit them. For CI, add repo secrets `KEYSTORE_BASE64` and `KEYSTORE_PASSWORD`. `.github/workflows/android.yml` then builds and signs on every push.

### Rebuild locally
```bash
# Node 22, JDK 21, Android SDK 36
npm ci && cd native && npm install
npm run web && npx cap add android && node scripts/patch-android.mjs && npx cap sync android
cd android && ./gradlew assembleRelease bundleRelease
```

### iOS
Run `cd native && npx cap add ios && npm run ios` on a Mac with Xcode. You need an Apple Developer account ($99/yr). iOS background runs are best-effort: the OS decides when and whether to wake the app.

## 2. Web app: server for everyone

The repo includes a `Dockerfile` (Node + Chromium for Lighthouse and screenshots, SQLite on a volume).

### Railway / Render / Fly.io (easiest)
1. Push this repo to GitHub.
2. Create a new service from the repo. It auto-detects the `Dockerfile`.
3. Attach a **persistent volume** at `/app/looi-data`. Missions, ads and the DB live there.
4. Set env vars:
   - `PORT=5000`
   - `LOOI_PUBLIC_URL=https://your-domain.com`: needed for tracked links, OAuth callbacks and Instagram media
   - `COMPOSIO_API_KEY=...`: optional, so users don't need their own
   - Optional AI defaults: users can also set Groq / NIM keys in Settings
5. Add your custom domain. HTTPS is automatic on all three.

### VPS (DigitalOcean, Hetzner, AWS Lightsail, ~$5–6/mo)
```bash
docker build -t looi .
docker run -d --restart=always -p 5000:5000 -v /srv/looi:/app/looi-data \
  -e LOOI_PUBLIC_URL=https://looi.example.com -e COMPOSIO_API_KEY=... looi
```
Put Caddy or Nginx in front for HTTPS (`caddy reverse-proxy --from looi.example.com --to :5000`).

### Point the app at your server (optional)
In the Android app: Settings → Where Looi runs → "Use a Looi server instead", then enter your URL.

## 3. Before you go public
- Multi-user: the server is single-tenant per device ID today. Add real auth (e.g. Clerk/Auth.js) before opening it to strangers.
- Rate limits and costs: X API posts cost money per post (https://docs.x.com/x-api/getting-started/pricing). Composio and LLM providers have their own quotas.
- Privacy policy + terms are required by Google Play and by most OAuth platforms.
