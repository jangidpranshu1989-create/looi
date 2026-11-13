import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Gauge, Clapperboard, Send, RefreshCcw, Cpu, Smartphone, ShieldCheck, Sparkles, Github, Star, KeyRound, Gift } from "lucide-react";
import { PricingCards } from "@/components/pricing";
import { useMe } from "@/lib/auth";
import { setPendingUrl } from "@/pages/auth";
import { GITHUB_URL, SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY, waLink } from "@/lib/config";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
    onError: (e: Error) => {
      if (/sign in/i.test(e.message)) {
        setPendingUrl(url);
        return nav("/signup");
      }
      toast({ title: "Couldn't start mission", description: e.message, variant: "destructive" });
    },
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

const scrollTo = (id: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
};

export default function Landing() {
  const { data: me } = useMe();
  const [, nav] = useLocation();
  const signedIn = !me?.saas || !!me?.user;
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <LivePill />
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Wordmark />
          <nav className="flex items-center gap-1 text-sm">
            <a href="#how" onClick={scrollTo("how")} className="hidden px-3 py-2 text-muted-foreground hover:text-foreground md:block">How it works</a>
            <a href="#pricing" onClick={scrollTo("pricing")} className="hidden px-3 py-2 text-muted-foreground hover:text-foreground sm:block" data-testid="link-pricing-nav">Pricing</a>
            <Link href="/download" className="hidden px-3 py-2 text-muted-foreground hover:text-foreground md:block" data-testid="link-download-nav">Apps</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 px-3 py-2 text-muted-foreground hover:text-foreground lg:inline-flex" data-testid="link-github-nav"><Github className="size-4" /> GitHub</a>
            {signedIn ? (
              <Link href="/app">
                <Button size="sm" variant="secondary" data-testid="button-open-app">Open dashboard</Button>
              </Link>
            ) : (
              <>
                <Link href="/login" className="px-3 py-2 text-muted-foreground hover:text-foreground" data-testid="link-login">Sign in</Link>
                <Link href="/signup">
                  <Button size="sm" data-testid="button-start-free">Start free</Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-16 md:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.25fr_1fr]">
          <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary looi-pulse" /> Autonomous marketing agent · runs 24/7
          </div>
          <h1 className="mt-6 max-w-3xl font-display text-[clamp(2.5rem,5.4vw,4.5rem)] font-extrabold leading-[0.98] tracking-tight">
            Paste a URL.
            <br />
            <span className="text-primary">Looi markets it</span> until it hits.
          </h1>
          <p className="mt-6 max-w-xl text-base text-muted-foreground md:text-lg">
            One mission: make your app a hit. Looi audits your site for real, produces animated ads from your actual product, publishes them to your channels, and keeps re-checking every few hours — switching tactics on its own when something isn't working.
          </p>
          <div className="mt-8">
            <UrlLauncher />
            <p className="mt-3 text-xs text-muted-foreground">Free {me?.trialDays ?? 7}-day trial · no credit card · no API keys. Every score is measured, every ad is rendered from your live site.</p>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5 text-primary" /> Looi AI included, no keys to paste</span>
            <span className="inline-flex items-center gap-1.5"><Smartphone className="size-3.5 text-primary" /> Web, Android and iOS</span>
            <span className="inline-flex items-center gap-1.5"><Github className="size-3.5 text-primary" /> Open source</span>
          </div>
          </div>
          <HeroPhone />
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
                ["Background work", "Close the tab or the app. The agent keeps running in the cloud and notifies you."],
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
            <p className="font-mono text-xs uppercase tracking-widest text-primary">The brain</p>
            <h2 className="mt-3 font-display text-3xl font-extrabold">Looi AI is built in.</h2>
            <p className="mt-4 text-sm text-muted-foreground">It runs on fast open models out of the box. Power users can switch to their own Groq, NVIDIA NIM or any OpenAI-compatible key in Settings.</p>
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

      <section className="border-t border-border" id="pricing">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Pricing</p>
            <h2 className="mt-3 font-display text-3xl font-extrabold md:text-4xl">Start free. Pay when it's working.</h2>
            <p className="mt-3 text-muted-foreground">Every account starts with a {me?.trialDays ?? 7}-day Pro trial. No card needed, and you drop to Free automatically if you don't upgrade.</p>
          </div>
          <div className="mt-12">
            <PricingCards plans={me?.plans} trialDays={me?.trialDays} onChoose={() => nav(me?.user ? "/app/billing" : "/signup")} />
          </div>
          <p className="mt-6 inline-flex w-full items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"><Gift className="size-3.5" /> Self-hosting for yourself is free forever. Looi is open source.</p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Open source</p>
            <h2 className="mt-3 font-display text-3xl font-extrabold">Built in the open.</h2>
            <p className="mt-4 text-sm text-muted-foreground">Read every line of the agent, run it on your own server, or send a pull request. Looi is AGPL-3.0 licensed.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Button variant="secondary" data-testid="button-github"><Github className="size-4" /> View on GitHub</Button>
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Button variant="ghost" data-testid="button-star"><Star className="size-4" /> Star the repo</Button>
              </a>
            </div>
          </div>
          <Accordion type="single" collapsible className="rounded-2xl border border-border bg-card px-5">
            {[
              ["Do I need API keys?", "No. Looi AI, the site audit and ad rendering run on our servers and are included in every plan. You only connect the social accounts you want Looi to post to, with one click."],
              ["Is anything fake or simulated?", "No. Scores come from real Lighthouse runs, ads are rendered from screenshots of your live site, and metrics come from the platforms you connect."],
              ["Will it post without asking?", "Only if you turn on Autopilot. By default Looi asks for approval before every publish, right from the pill at the top of the screen."],
              ["What happens after the trial?", "You move to the Free plan automatically. Nothing is charged until you choose Pro or Scale and pay with UPI, card or netbanking."],
              ["Can I run it myself?", "Yes. The full source is on GitHub with a one-click Render blueprint and a Docker image. Self-hosted Looi has no limits."],
            ].map(([q, a], i) => (
              <AccordionItem key={q} value={`q${i}`} className={i === 4 ? "border-b-0" : ""}>
                <AccordionTrigger className="text-left text-sm font-medium" data-testid={`faq-${i}`}>{q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
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
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-xs text-muted-foreground">
          <Wordmark className="opacity-70" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href={waLink()} target="_blank" rel="noreferrer" className="hover:text-foreground" data-testid="link-whatsapp">WhatsApp {SUPPORT_PHONE_DISPLAY}</a>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-foreground" data-testid="link-email">{SUPPORT_EMAIL}</a>
            <Link href="/privacy" className="hover:text-foreground" data-testid="link-privacy">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground" data-testid="link-terms">Terms</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Product mockup: the Looi mobile app mid-mission, with the live pill. */
function HeroPhone() {
  return (
    <div className="relative mx-auto hidden w-[300px] lg:block" aria-hidden="true">
      <div className="looi-float">
        <div className="phone-frame relative overflow-hidden rounded-[44px] border-[6px] border-[#1b1b1f] bg-[#0b0b0d]">
          <div className="flex h-[600px] flex-col px-4 pb-5 pt-3">
            <div className="mx-auto flex h-8 w-[200px] items-center gap-2 rounded-full bg-black px-2 ring-1 ring-white/10">
              <span className="grid size-5 place-items-center rounded-full bg-primary/15"><LooiMark className="size-3.5" spinning /></span>
              <span className="truncate text-[11px] font-medium text-foreground">Producing ads · 3/4</span>
              <span className="ml-auto font-mono text-[10px] text-primary">81%</span>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <Wordmark />
              <span className="grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">2</span>
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[.03] p-3">
              <p className="inline-flex items-center gap-1.5 text-[10px] font-medium text-primary"><span className="size-1.5 rounded-full bg-primary looi-pulse" /> On duty</p>
              <p className="mt-1.5 font-display text-[15px] font-bold leading-snug">Marketing 2 products, around the clock.</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Next re-check in 2h 14m</p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[["Health", "86", "text-ok"], ["Ads", "12", ""], ["Posts", "31", ""]].map(([l, v, c]) => (
                <div key={l} className="rounded-xl border border-white/10 bg-white/[.03] px-2 py-2">
                  <p className="text-[9px] text-muted-foreground">{l}</p>
                  <p className={`font-mono text-sm font-semibold ${c}`}>{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
              <div className="relative aspect-[4/3] bg-[radial-gradient(120%_90%_at_0%_0%,#3b2f8a_0%,#14122b_55%,#0b0b0d_100%)] p-3">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/70">Stop guessing</p>
                <p className="mt-1 font-display text-[17px] font-extrabold leading-tight text-white">Ship ads <span className="text-[#a9a2ff]">while</span> you sleep</p>
                <span className="mt-2 inline-block rounded-full bg-[#7c6cf0] px-2.5 py-1 text-[9px] font-semibold text-white">Try it free →</span>
                <div className="absolute -bottom-5 right-3 w-36 rotate-[-4deg] overflow-hidden rounded-lg bg-[#f4f4f6] shadow-2xl">
                  <div className="flex gap-1 bg-[#e6e6ea] px-2 py-1"><span className="size-1 rounded-full bg-[#c2c2c8]" /><span className="size-1 rounded-full bg-[#c2c2c8]" /><span className="size-1 rounded-full bg-[#c2c2c8]" /></div>
                  <div className="space-y-1 p-2"><div className="h-1.5 w-16 rounded bg-[#1b1b1f]" /><div className="h-1 w-24 rounded bg-[#c9c9cf]" /><div className="h-1 w-20 rounded bg-[#c9c9cf]" /><div className="mt-1.5 h-3 w-12 rounded bg-[#7c6cf0]" /></div>
                </div>
              </div>
              <div className="flex items-center justify-between bg-white/[.03] px-3 py-2">
                <span className="text-[10px] text-muted-foreground">1:1 · 8s · MP4</span>
                <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold text-primary-foreground">Approve</span>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[.03] p-2.5">
              <div className="flex items-center justify-between text-[10px]"><span className="text-muted-foreground">Strategist</span><span className="font-mono text-primary">PIVOT</span></div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10"><div className="looi-bar h-full rounded-full bg-primary" /></div>
              <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">Low traction on X. Trying a Reddit launch + 9:16 story ad.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -left-24 bottom-32 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-2xl backdrop-blur">
        <p className="text-[10px] text-muted-foreground">Lighthouse · mobile</p>
        <p className="font-mono text-sm font-semibold"><span className="text-ok">94</span> perf · <span className="text-ok">100</span> SEO</p>
      </div>
      <div className="absolute -right-20 top-[372px] rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-2xl backdrop-blur">
        <p className="text-[10px] text-muted-foreground">Published</p>
        <p className="text-xs font-semibold">X · LinkedIn · Telegram</p>
      </div>
    </div>
  );
}
