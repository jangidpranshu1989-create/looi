import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Clapperboard, Send, MousePointerClick, Clock, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Empty, Favicon, ScoreRing, StatusPill, timeAgo, scoreTone } from "@/components/looi";
import { UrlLauncher } from "./landing";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { data: missions, isLoading } = useQuery<any[]>({ queryKey: ["/api/missions"], refetchInterval: 15000, staleTime: 0 });
  const totals = (missions || []).reduce((a, m) => ({ ads: a.ads + m.creativeCount, posts: a.posts + m.postCount, clicks: a.clicks + m.clickCount }), { ads: 0, posts: 0, clicks: 0 });
  return (
    <AppShell title="Missions">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-bold">Missions</h1>
        <p className="text-sm text-muted-foreground">Every URL is a mission. Looi keeps working on each one until it hits.</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Active missions", (missions || []).filter((m) => m.status !== "paused" && m.status !== "failed").length],
          ["Ads produced", totals.ads],
          ["Posts published", totals.posts],
          ["Tracked clicks", totals.clicks],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular" data-testid={`stat-${String(l).toLowerCase().replace(/ /g, "-")}`}>
              {isLoading ? "–" : v}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <UrlLauncher size="md" testId="dashboard" />
      </div>

      <div className="mt-8 space-y-3">
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
