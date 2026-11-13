import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Gauge, Clapperboard, Send, RefreshCcw, Cpu, Smartphone, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LooiMark, Wordmark } from "@/components/looi";
import { LivePill } from "@/components/live-pill";

export function UrlLauncher({ size = "lg", testId = "hero" }: { size?: "lg" | "md"; testId?: string }) {
  const [url, setUrl] = useState("");
  const [, nav] = useLocation();
  const { toast } = useToast();
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/missions", { url })).json(),
    onSuccess: (m) => {
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      nav(`/app/m/${m.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't start mission", description: e.message, variant: "destructive" }),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) start.mutate();
      }}
      className={`flex w-full items-center gap-2 rounded-2xl border border-border bg-card p-1.5 shadow-xl focus-within:border-primary/60 ${size === "lg" ? "max-w-xl" : ""}`}
    >
      <span className="pl-3 font-mono text-sm text-muted-foreground">https://</span>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value.replace(/^https?:\/\//, ""))}
        placeholder="yourapp.com"
        className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0"
        aria-label="Your app or website URL"
        data-testid={`input-url-${testId}`}
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
      />
      <Button type="submit" size="lg" className="h-11 shrink-0 rounded-xl px-4 font-semibold" disabled={start.isPending || !url.trim()} data-testid={`button-launch-${testId}`}>
        {start.isPending ? "Starting…" : "Launch"}
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}

const STEPS = [
  { icon: Gauge, title: "Deep site audit", body: "Real Lighthouse runs on mobile and desktop, Core Web Vitals, security headers, SEO, broken links, tech stack and an AI UI/UX review of your actual screenshot." },
  { icon: Clapperboard, title: "Production ads", body: "Looi captures your real UI and brand colors, writes angles, and renders animated MP4 ads in square, story and landscape — plus posters for every one." },
  { icon: Send, title: "Auto-publish", body: "One-click plugins for X, LinkedIn, Facebook, Instagram, Reddit, Slack, Discord, Telegram, Gmail and 1,000+ apps. No API keys to copy. Every post carries a tracked link." },
  { icon: RefreshCcw, title: "24/7 re-check", body: "Every 2–3 hours Looi re-measures your site, reads post metrics and clicks, and decides: scale, iterate, or pivot to a new route." },
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <LivePill />
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Wordmark />
          <nav className="flex items-center gap-1 text-sm">
            <a href="#how" onClick={(e) => { e.preventDefault(); document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }); }} className="hidden px-3 py-2 text-muted-foreground hover:text-foreground sm:block">How it works</a>
            <Link href="/download" className="hidden px-3 py-2 text-muted-foreground hover:text-foreground sm:block" data-testid="link-download-nav">Apps</Link>
            <Link href="/app">
              <Button size="sm" variant="secondary" data-testid="button-open-app">Open dashboard</Button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-20 md:pt-28">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary looi-pulse" /> Autonomous marketing agent · runs 24/7
          </div>
          <h1 className="mt-6 max-w-3xl font-display text-[clamp(2.5rem,6vw,4.75rem)] font-extrabold leading-[0.98]">
            Paste a URL.
            <br />
            <span className="text-primary">Looi markets it</span> until it hits.
          </h1>
          <p className="mt-6 max-w-xl text-base text-muted-foreground md:text-lg">
            One mission: make your app a hit. Looi audits your site for real, produces animated ads from your actual product, publishes them to your channels, and keeps re-checking every few hours — switching tactics on its own when something isn't working.
          </p>
          <div className="mt-8">
            <UrlLauncher />
            <p className="mt-3 text-xs text-muted-foreground">Nothing is faked: every score is measured, every ad is rendered from your live site.</p>
          </div>

          <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4" id="how">
            {STEPS.map((s, i) => (
              <div key={s.title} className="bg-card p-6">
                <div className="flex items-center justify-between">
                  <s.icon className="size-5 text-primary" />
                  <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                </div>
                <h3 className="mt-5 font-display text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">The loop</p>
            <h2 className="mt-3 font-display text-3xl font-extrabold md:text-4xl">It doesn't stop after posting.</h2>
            <p className="mt-4 text-muted-foreground">
              If a cycle shows weak traction, the strategist changes the angle, format or template, writes ready-to-paste launches for Product Hunt, Reddit, Hacker News or cold email, and flags site fixes that block conversion. You get a short update every cycle.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                ["Approval mode", "Looi asks before every publish — approve right from the pill at the top of the screen."],
                ["Autopilot", "Looi publishes on its own and just keeps you posted."],
                ["Background work", "Close the tab. The agent keeps running on the server and the app notifies you."],
              ].map(([t, b]) => (
                <li key={t} className="flex gap-3">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    <span className="font-medium">{t}.</span> <span className="text-muted-foreground">{b}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mx-auto flex w-fit items-center gap-2.5 rounded-full bg-black py-1.5 pl-1.5 pr-4 text-white ring-1 ring-white/10">
              <span className="grid size-7 place-items-center rounded-full bg-white/[.07]">
                <LooiMark className="size-5" spinning />
              </span>
              <span className="text-[13px] font-medium">yourapp · Producing ads</span>
              <span className="font-mono text-xs text-primary">72%</span>
            </div>
            <div className="mt-6 space-y-2 font-mono text-xs">
              {[
                ["09:00", "Cycle 4 · mobile perf 61 → 74 after image fix", "text-ok"],
                ["09:01", "X post #3: 2.1k views, 0.4% CTR — below baseline", "text-warn"],
                ["09:01", "Decision: pivot → 'Pain killer' angle, story format", "text-primary"],
                ["09:03", "Rendered 1080×1920 MP4 · 8.0s · 30fps", "text-muted-foreground"],
                ["09:03", "Approval requested · X, LinkedIn", "text-muted-foreground"],
                ["11:30", "Next check scheduled", "text-muted-foreground"],
              ].map(([t, l, c], i) => (
                <div key={i} className="flex gap-3 rounded-md bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground/60">{t}</span>
                  <span className={c}>{l}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">Illustration of the agent log format</p>
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-20 md:grid-cols-2 lg:grid-cols-4">
          <div className="md:col-span-1">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Bring your own brain</p>
            <h2 className="mt-3 font-display text-3xl font-extrabold">Any OpenAI-compatible model.</h2>
            <p className="mt-4 text-sm text-muted-foreground">Plug in your own key — Looi works with any endpoint that speaks the OpenAI chat API. A built-in engine is available as a fallback.</p>
          </div>
          {[
            { icon: Cpu, t: "Groq", d: "Fast inference at api.groq.com/openai/v1 — default openai/gpt-oss-120b." },
            { icon: Sparkles, t: "NVIDIA NIM", d: "integrate.api.nvidia.com/v1 — hosted NIM endpoints with your nvapi key." },
            { icon: Cpu, t: "OpenAI & custom", d: "OpenAI, OpenRouter, Together, local vLLM / Ollama — set any base URL." },
          ].map((p) => (
            <div key={p.t} className="rounded-2xl border border-border bg-card p-6">
              <p.icon className="size-5 text-primary" />
              <h3 className="mt-4 font-display text-lg font-bold">{p.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-5 py-20 md:flex-row md:items-center">
          <div>
            <h2 className="font-display text-3xl font-extrabold">Start your first mission.</h2>
            <p className="mt-2 text-muted-foreground">Web, Android and iOS — the same agent, with native notifications.</p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[460px]">
            <UrlLauncher size="md" testId="footer" />
            <Link href="/download" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <Smartphone className="size-4" /> Get the native app
            </Link>
          </div>
        </div>
      </section>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 text-xs text-muted-foreground">
          <Wordmark className="opacity-70" />
          <span>Looi · autonomous marketing agent</span>
        </div>
      </footer>
    </div>
  );
}
