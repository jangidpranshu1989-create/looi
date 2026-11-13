import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Clapperboard, Send, MousePointerClick, Clock, ArrowRight, Check, Smartphone, Cloud, KeyRound, Plug, Gauge } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Empty, Favicon, ScoreRing, StatusPill, timeAgo, scoreTone, useLive, LooiMark } from "@/components/looi";
import { UrlLauncher } from "./landing";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient, isDeviceMode } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { data: missions, isLoading } = useQuery<any[]>({ queryKey: ["/api/missions"], refetchInterval: 15000, staleTime: 0 });
  const totals = (missions || []).reduce((a, m) => ({ ads: a.ads + m.creativeCount, posts: a.posts + m.postCount, clicks: a.clicks + m.clickCount }), { ads: 0, posts: 0, clicks: 0 });
  return (
    <AppShell title="Missions">
      <AgentHero missions={missions || []} />
      <SetupChecklist />

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Active missions", (missions || []).filter((m) => m.status !== "paused" && m.status !== "failed").length],
          ["Ads produced", totals.ads],
          ["Posts published", totals.posts],
          [isDeviceMode() ? "Cycles run" : "Tracked clicks", isDeviceMode() ? (missions || []).reduce((a, m) => a + (m.cycle || 0), 0) : totals.clicks],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="mt-0.5 font-mono text-xl font-semibold tabular" data-testid={`stat-${String(l).toLowerCase().replace(/ /g, "-")}`}>
              {isLoading ? "–" : v}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 flex items-end justify-between">
        <h2 className="font-display text-lg font-bold">Missions</h2>
        <p className="text-xs text-muted-foreground">{(missions || []).length} total</p>
      </div>
      <div className="mt-3 space-y-3">
        {isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        {!isLoading && missions?.length === 0 && <Empty title="No missions yet" body="Paste your app or website URL above. Looi will audit it, make ads and start the 24/7 loop." />}
        {missions?.map((m) => (
          <Link key={m.id} href={`/app/m/${m.id}`}>
            <div className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-4 hover-elevate md:flex-row md:items-center" data-testid={`card-mission-${m.id}`}>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Favicon src={m.favicon} name={m.name} className="size-10" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{m.name}</p>
                    <StatusPill status={m.status} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{m.oneLiner || m.url}</p>
                  {m.running ? (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary transition-all" style={{ width: `${m.running.progress}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{m.running.stage}</span>
                    </div>
                  ) : m.status === "failed" ? (
                    <p className="mt-1 line-clamp-1 text-xs text-bad">{m.lastError}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-5 text-sm md:gap-7">
                <div className="text-center">
                  <p className={cn("font-mono text-xl font-semibold", scoreTone(m.healthScore || null))}>{m.healthScore || "–"}</p>
                  <p className="text-[11px] text-muted-foreground">Health</p>
                </div>
                <Metric icon={Clapperboard} v={m.creativeCount} l="Ads" />
                <Metric icon={Send} v={m.postCount} l="Posts" />
                <Metric icon={MousePointerClick} v={m.clickCount} l="Clicks" />
                <div className="hidden text-right lg:block">
                  <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" /> {m.status === "active" ? `Next check ${timeAgo(m.nextCheckAt)}` : m.status === "paused" ? "Paused" : "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">Cycle {m.cycle}</p>
                </div>
                <ArrowRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

function Metric({ icon: I, v, l }: { icon: any; v: number; l: string }) {
  return (
    <div className="text-center">
      <p className="inline-flex items-center gap-1 font-mono text-base font-semibold">
        <I className="size-3.5 text-muted-foreground" />
        {v}
      </p>
      <p className="text-[11px] text-muted-foreground">{l}</p>
    </div>
  );
}

export function NewMission() {
  const [, nav] = useLocation();
  const { toast } = useToast();
  const { data: allChannels = [] } = useQuery<any[]>({ queryKey: ["/api/channels"] });
  const channels = allChannels.filter((c) => c.status === "connected");
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[] | null>(null);
  const sel = picked ?? channels.map((c) => c.id);
  const m = mode ?? settings?.defaultMode ?? "approval";
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/missions", { url, goal, mode: m, channelIds: sel })).json(),
    onSuccess: (x) => {
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      nav(`/app/m/${x.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't start mission", description: e.message, variant: "destructive" }),
  });
  return (
    <AppShell title="New mission">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-xl font-bold">New mission</h1>
        <p className="mt-1 text-sm text-muted-foreground">Looi will audit the site, produce 4 animated ads and start re-checking every {Math.round(((settings?.intervalMinutes || 150) / 60) * 10) / 10} hours.</p>
        <form
          className="mt-6 space-y-6 rounded-xl border border-border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="url">App or website URL</Label>
            <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourapp.com" required data-testid="input-mission-url" inputMode="url" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal">Goal (optional)</Label>
            <Textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. 500 signups this month from indie developers in India" data-testid="input-mission-goal" />
          </div>
          <div className="space-y-2">
            <Label>Publishing mode</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["approval", "Ask me first", "Approve each batch from the pill or Approvals."],
                ["autopilot", "Autopilot", "Publish automatically, keep me posted."],
              ].map(([v, t, d]) => (
                <button type="button" key={v} onClick={() => setMode(v)} className={cn("rounded-lg border p-3 text-left hover-elevate", m === v ? "border-primary bg-primary/5" : "border-border")} data-testid={`button-mode-${v}`}>
                  <p className="text-sm font-medium">{t}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Publish to</Label>
            {channels.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                No plugins connected. Ads will still be produced and downloadable.{" "}
                <Link href="/app/channels" className="text-primary">
                  Connect a plugin
                </Link>
              </p>
            ) : (
              <div className="space-y-2">
                {channels.map((c) => (
                  <label key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                    <Checkbox checked={sel.includes(c.id)} onCheckedChange={(v) => setPicked(v ? [...sel, c.id] : sel.filter((x) => x !== c.id))} data-testid={`checkbox-channel-${c.id}`} />
                    {c.name}
                    <span className={cn("ml-auto text-xs", c.status === "connected" ? "text-ok" : "text-bad")}>{c.status}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={!url.trim() || start.isPending} data-testid="button-start-mission">
            {start.isPending ? "Starting…" : "Start mission"}
          </Button>
        </form>
      </div>
    </AppShell>
  );
}

function useCountdown(ts?: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  if (!ts) return "";
  const d = Math.max(0, ts - Date.now());
  const h = Math.floor(d / 3600000);
  const m = Math.round((d % 3600000) / 60000);
  return d < 60000 ? "any moment" : h ? `${h}h ${m}m` : `${m}m`;
}

function AgentHero({ missions }: { missions: any[] }) {
  const { data: live } = useLive();
  const job = live?.jobs?.[0];
  const active = missions.filter((m) => m.status === "active");
  const next = active.map((m) => m.nextCheckAt).filter(Boolean).sort((a, b) => a - b)[0];
  const countdown = useCountdown(next);
  const device = isDeviceMode();
  const pending = live?.approvals?.length || 0;
  return (
    <section className="hero-glow relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-7" data-testid="agent-hero">
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary">
              <span className="size-1.5 rounded-full bg-primary looi-pulse" /> {job ? "Working" : active.length ? "On duty" : "Ready"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-muted-foreground">
              {device ? <Smartphone className="size-3" /> : <Cloud className="size-3" />} {device ? "Runs on this phone" : "Cloud agent"}
            </span>
          </div>
          <h1 className="mt-4 font-display text-2xl font-extrabold leading-tight md:text-3xl" data-testid="text-agent-headline">
            {job ? (
              <>
                {job.stage.replace(/ \d+%$/, "")} <span className="text-muted-foreground">· {job.name}</span>
              </>
            ) : active.length ? (
              <>Marketing {active.length} {active.length === 1 ? "product" : "products"}, around the clock.</>
            ) : (
              <>Paste a URL. Looi takes it from there.</>
            )}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {job
              ? `${job.progress}% · started ${timeAgo(job.startedAt)}`
              : active.length
                ? `Next re-check in ${countdown || "—"}${pending ? ` · ${pending} approval${pending > 1 ? "s" : ""} waiting` : ""}`
                : "Audit, ads, publishing and 24/7 re-checks — in one mission."}
          </p>
          {job && (
            <div className="mt-3 h-1 w-full max-w-sm overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${job.progress}%` }} />
            </div>
          )}
        </div>
        <div className="w-full lg:max-w-md">
          <UrlLauncher size="md" testId="dashboard" />
          {pending > 0 && (
            <Link href="/app/approvals" className="mt-2 inline-flex items-center gap-1 text-xs text-primary" data-testid="link-hero-approvals">
              Review {pending} pending approval{pending > 1 ? "s" : ""} <ArrowRight className="size-3" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function SetupChecklist() {
  const { data: s } = useQuery<any>({ queryKey: ["/api/settings"], staleTime: 0 });
  const { data: chans = [] } = useQuery<any[]>({ queryKey: ["/api/channels"], staleTime: 0 });
  if (!s) return null;
  const hasChannel = chans.some((c) => c.status === "connected");
  const items = [
    { done: s.hasApiKey || (!s.device && s.builtinAvailable), icon: KeyRound, title: "Add an AI key", body: "Free Groq or NVIDIA NIM key — powers the audit, copy and strategist.", href: "/app/settings", cta: "Add key" },
    { done: hasChannel, icon: Plug, title: "Connect your channels", body: "One-click X, LinkedIn, Reddit, Telegram and more. Looi posts there for you.", href: "/app/channels", cta: "Connect" },
    ...(s.device ? [{ done: s.hasPsiKey, icon: Gauge, title: "PageSpeed key (recommended)", body: "Google's free key makes Lighthouse reliable — the shared quota is often exhausted.", href: "/app/settings", cta: "Add key" }] : []),
  ];
  const left = items.filter((i) => !i.done).length;
  if (!left) return null;
  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-4 md:p-5" data-testid="setup-checklist">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Finish setup <span className="text-muted-foreground">· {items.length - left}/{items.length}</span></p>
        <div className="flex gap-1">{items.map((i, k) => <span key={k} className={cn("h-1 w-6 rounded-full", i.done ? "bg-primary" : "bg-muted")} />)}</div>
      </div>
      <div className={cn("mt-3 grid gap-2", items.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {items.map((i) => (
          <div key={i.title} className={cn("flex items-start gap-3 rounded-xl border p-3", i.done ? "border-border/50 opacity-60" : "border-border bg-background/40")}>
            <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", i.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
              {i.done ? <Check className="size-4" /> : <i.icon className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{i.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{i.body}</p>
              {!i.done && (
                <Link href={i.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary" data-testid={`link-setup-${i.cta.toLowerCase().replace(/ /g, "-")}`}>
                  {i.cta} <ArrowRight className="size-3" />
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
