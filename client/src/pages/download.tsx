import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Smartphone, Monitor, Server, Download as DownloadIcon, Check, Bell, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/looi";

export default function DownloadPage() {
  const [prompt, setPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const h = (e: any) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <Link href="/"><Wordmark /></Link>
          <Link href="/app"><Button size="sm" variant="secondary" data-testid="button-open-dashboard">Open dashboard</Button></Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-14">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Apps</p>
        <h1 className="mt-3 font-display text-4xl font-extrabold">Looi everywhere.</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">The agent runs on your Looi server around the clock. The apps are your control room — live pill, approvals and native notifications.</p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-6">
            <Smartphone className="size-5 text-primary" />
            <h2 className="mt-4 font-display text-lg font-bold">Android</h2>
            <p className="mt-2 text-sm text-muted-foreground">Native Capacitor app with background polling and local notifications for approvals and cycle updates.</p>
            <div className="mt-4 rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              cd native && npm i<br />npm run android:apk
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Or push the repo to GitHub — the included workflow builds a signed-debug APK automatically.</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <Smartphone className="size-5 text-primary" />
            <h2 className="mt-4 font-display text-lg font-bold">iOS</h2>
            <p className="mt-2 text-sm text-muted-foreground">Same codebase. Open in Xcode, set your team and run on device or ship to TestFlight.</p>
            <div className="mt-4 rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              cd native && npm i<br />npx cap add ios && npx cap open ios
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <Monitor className="size-5 text-primary" />
            <h2 className="mt-4 font-display text-lg font-bold">Install from browser</h2>
            <p className="mt-2 text-sm text-muted-foreground">Add Looi to your home screen or desktop as an installable app.</p>
            {installed ? (
              <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-ok"><Check className="size-4" /> Installed</p>
            ) : prompt ? (
              <Button className="mt-4" onClick={async () => { prompt.prompt(); await prompt.userChoice; setPrompt(null); }} data-testid="button-install-pwa"><DownloadIcon className="size-4" /> Install Looi</Button>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">Use your browser menu → “Install app” or “Add to Home Screen”.</p>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <Server className="size-5 text-primary" />
            <h2 className="mt-4 font-display text-lg font-bold">Self-host the agent 24/7</h2>
            <p className="mt-2 text-sm text-muted-foreground">Looi's loop runs wherever the server runs. One container includes Chromium, Lighthouse and FFmpeg.</p>
            <div className="mt-4 rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              docker build -t looi .<br />docker run -d -p 5000:5000 -v looi-data:/app/looi-data looi
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <Bell className="size-5 text-primary" />
            <h2 className="mt-4 font-display text-lg font-bold">Connect the app to your server</h2>
            <p className="mt-2 text-sm text-muted-foreground">On first launch the native app asks for your Looi server URL. Each device gets its own private workspace on that server.</p>
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Terminal className="size-3.5" /> Works with any reachable URL — VPS, Railway, Fly.io, or your laptop on the same Wi-Fi.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
