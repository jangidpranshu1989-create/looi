import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Pause, Play, RefreshCcw, Wand2, Trash2, Download, Send, Copy, Check, AlertTriangle, CheckCircle2, XCircle, Monitor, Smartphone, Clock, Bot } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart, Legend } from "recharts";
import { AppShell } from "@/components/app-shell";
import { Favicon, ScoreRing, Severity, StatusPill, timeAgo, scoreTone, Empty } from "@/components/looi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiRequest, queryClient, mediaUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const METRIC_LABEL: Record<string, string> = { fcp: "First Contentful Paint", lcp: "Largest Contentful Paint", tbt: "Total Blocking Time", cls: "Cumulative Layout Shift", si: "Speed Index", tti: "Time to Interactive" };
const SEC_LABEL: Record<string, string> = { "strict-transport-security": "HSTS", "content-security-policy": "CSP", "x-frame-options": "X-Frame-Options", "x-content-type-options": "X-Content-Type-Options", "referrer-policy": "Referrer-Policy", "permissions-policy": "Permissions-Policy" };

export default function MissionPage() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const { toast } = useToast();
  const { data: m, isLoading, error } = useQuery<any>({ queryKey: ["/api/missions", id], refetchInterval: 10000, staleTime: 0 });
  const inv = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/missions", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/live"] });
  };
  const patch = useMutation({ mutationFn: (b: any) => apiRequest("PATCH", `/api/missions/${id}`, b), onSuccess: inv });
  const check = useMutation({ mutationFn: () => apiRequest("POST", `/api/missions/${id}/check`), onSuccess: () => { inv(); toast({ title: "Re-check queued", description: "Watch progress in the pill at the top." }); } });
  const gen = useMutation({ mutationFn: () => apiRequest("POST", `/api/missions/${id}/generate`), onSuccess: () => { inv(); toast({ title: "Producing new ads", description: "A fresh angle is being rendered." }); } });
  const del = useMutation({ mutationFn: () => apiRequest("DELETE", `/api/missions/${id}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/missions"] }); nav("/app"); } });
  const [confirmDel, setConfirmDel] = useState(false);

  if (isLoading) return <AppShell><Skeleton className="h-24 rounded-xl" /><Skeleton className="mt-4 h-96 rounded-xl" /></AppShell>;
  if (error || !m) return <AppShell><Empty title="Mission not found" body="It may have been deleted."><Link href="/app"><Button variant="secondary">Back to missions</Button></Link></Empty></AppShell>;

  const busy = !!m.running || m.status === "queued";
  const lh = m.report?.lighthouse;
  return (
    <AppShell title={<span>Missions / <span className="text-foreground">{m.name}</span></span>}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Favicon src={m.favicon} name={m.name} className="size-12" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-xl font-bold" data-testid="text-mission-name">{m.name}</h1>
              <StatusPill status={m.running ? "running" : m.status} testId="status-mission" />
            </div>
            <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-sm text-muted-foreground hover:text-foreground" data-testid="link-mission-url">
              {m.url} <ExternalLink className="size-3 shrink-0" />
            </a>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
            <Bot className="size-4 text-muted-foreground" /> Autopilot
            <Switch checked={m.mode === "autopilot"} onCheckedChange={(v) => patch.mutate({ mode: v ? "autopilot" : "approval" })} data-testid="switch-autopilot" />
          </label>
          <Button variant="secondary" size="sm" onClick={() => check.mutate()} disabled={busy || check.isPending} data-testid="button-recheck">
            <RefreshCcw className="size-4" /> {m.status === "failed" ? "Retry" : "Re-check now"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => gen.mutate()} disabled={busy || !m.brief?.angles || gen.isPending} data-testid="button-generate">
            <Wand2 className="size-4" /> New ad
          </Button>
          {m.status === "paused" ? (
            <Button size="sm" variant="secondary" onClick={() => patch.mutate({ status: "active" })} data-testid="button-resume"><Play className="size-4" /> Resume</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => patch.mutate({ status: "paused" })} disabled={m.status === "queued" || m.status === "failed"} data-testid="button-pause"><Pause className="size-4" /> Pause</Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => setConfirmDel(true)} aria-label="Delete mission" data-testid="button-delete"><Trash2 className="size-4" /></Button>
        </div>
      </div>

      {m.running && (
        <div className="mt-5 overflow-hidden rounded-xl border border-primary/30 bg-primary/[.04]">
          <div className="looi-shimmer h-0.5" />
          <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <div className="flex-1">
              <p className="text-sm font-medium">{m.running.stage}</p>
              <p className="text-xs text-muted-foreground">Looi is working in the background — you can leave this page.</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {m.running.steps.map((s: any) => (
                <span key={s.label} className={cn("rounded-full border px-2 py-0.5 text-[11px]", s.done ? "border-primary/30 text-primary" : s.label === m.running.stage ? "border-foreground/30 text-foreground" : "border-border text-muted-foreground/60")}>{s.label}</span>
              ))}
            </div>
            <span className="font-mono text-sm text-primary">{m.running.progress}%</span>
          </div>
        </div>
      )}
      {m.status === "failed" && !m.running && (
        <div className="mt-5 flex gap-3 rounded-xl border border-bad/30 bg-bad/5 p-4 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-bad" />
          <div><p className="font-medium">Mission failed</p><p className="mt-0.5 break-words text-muted-foreground">{m.lastError}</p></div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat l="Health score" v={m.healthScore || "–"} cls={scoreTone(m.healthScore || null)} />
        <Stat l="Mobile performance" v={lh?.mobile?.scores?.performance ?? "–"} cls={scoreTone(lh?.mobile?.scores?.performance)} />
        <Stat l="Ads produced" v={m.creatives.filter((c: any) => c.videoFile).length} />
        <Stat l="Tracked clicks" v={m.tracking ? m.posts.reduce((a: number, p: any) => a + p.clicks, 0) : "off"} />
        <Stat l={m.status === "active" ? "Next check" : "Cycle"} v={m.status === "active" ? timeAgo(m.nextCheckAt) : m.cycle} small />
      </div>

      <Tabs defaultValue="report" className="mt-6">
        <TabsList className="h-auto w-full justify-start overflow-x-auto bg-transparent p-0 border-b border-border rounded-none">
          {[["report", "Site report"], ["ads", `Ads · ${m.creatives.length}`], ["publishing", `Publishing · ${m.posts.length}`], ["analytics", "Analytics"], ["playbooks", `Playbooks · ${m.playbooks.length}`], ["log", "Agent log"]].map(([v, l]) => (
            <TabsTrigger key={v} value={v} className="rounded-none border-b-2 border-transparent px-3 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" data-testid={`tab-${v}`}>{l}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="report" className="mt-6"><Report m={m} /></TabsContent>
        <TabsContent value="ads" className="mt-6"><Ads m={m} /></TabsContent>
        <TabsContent value="publishing" className="mt-6"><Publishing m={m} /></TabsContent>
        <TabsContent value="analytics" className="mt-6"><Analytics m={m} /></TabsContent>
        <TabsContent value="playbooks" className="mt-6"><Playbooks m={m} /></TabsContent>
        <TabsContent value="log" className="mt-6"><Log m={m} /></TabsContent>
      </Tabs>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this mission?</AlertDialogTitle>
            <AlertDialogDescription>Looi stops monitoring {m.name}. Ads, reports and logs are removed. Published posts stay on your channels.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()} data-testid="button-confirm-delete">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Stat({ l, v, cls, small }: { l: string; v: any; cls?: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{l}</p>
      <p className={cn("mt-1 font-mono font-semibold tabular", small ? "text-base" : "text-2xl", cls)}>{v}</p>
    </div>
  );
}

function Card({ title, children, right, className }: { title?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      {title && <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3"><h3 className="text-sm font-semibold">{title}</h3>{right}</div>}
      <div className="p-5">{children}</div>
    </section>
  );
}

function Check2({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
      <span className="min-w-0"><span>{label}</span>{detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}</span>
    </div>
  );
}

function Report({ m }: { m: any }) {
  const [dev, setDev] = useState<"mobile" | "desktop">("mobile");
  const r = m.report || {};
  const s = m.siteData || {};
  const rd = s.render || {};
  const lh = r.lighthouse?.[dev];
  const ai = r.ai;
  if (!s.finalUrl) return <Empty title="Audit in progress" body="Looi is fetching and rendering the site. Results appear here as each step finishes." />;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Lighthouse" right={
          <div className="flex rounded-md border border-border p-0.5">
            {(["mobile", "desktop"] as const).map((d) => (
              <button key={d} onClick={() => setDev(d)} className={cn("inline-flex items-center gap-1 rounded px-2 py-1 text-xs", dev === d ? "bg-muted text-foreground" : "text-muted-foreground")} data-testid={`button-lh-${d}`}>
                {d === "mobile" ? <Smartphone className="size-3" /> : <Monitor className="size-3" />}{d}
              </button>
            ))}
          </div>
        }>
          {lh ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-2">
                <ScoreRing value={lh.scores.performance} label="Performance" testId="score-performance" />
                <ScoreRing value={lh.scores.accessibility} label="Accessibility" testId="score-accessibility" />
                <ScoreRing value={lh.scores.bestPractices} label="Best practices" testId="score-best-practices" />
                <ScoreRing value={lh.scores.seo} label="SEO" testId="score-seo" />
              </div>
              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
                {Object.entries(lh.metrics).map(([k, v]: any) => (
                  <div key={k} className="bg-card p-3">
                    <p className="text-[11px] text-muted-foreground">{METRIC_LABEL[k] || k}</p>
                    <p className={cn("mt-0.5 font-mono text-base font-semibold", v.score == null ? "" : v.score >= 0.9 ? "text-ok" : v.score >= 0.5 ? "text-warn" : "text-bad")}>{String(v.display).replace(/\u00a0/g, " ")}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">Measured {timeAgo(r.measuredAt)} · {lh.source === "lighthouse-local" ? "Lighthouse run by Looi (simulated throttling)" : "Google PageSpeed Insights API"}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{m.running ? "Running Lighthouse…" : "Lighthouse data unavailable for this run."}</p>
          )}
        </Card>
        <Card title="Screenshots">
          <div className="flex gap-3">
            {rd.desktopShot && <a href={mediaUrl(rd.fullShot || rd.desktopShot)} target="_blank" rel="noopener noreferrer" className="block flex-[3] overflow-hidden rounded-lg border border-border"><img src={mediaUrl(rd.desktopShot)} alt="Desktop screenshot" className="w-full" data-testid="img-desktop-shot" /></a>}
            {rd.mobileShot && <a href={mediaUrl(rd.mobileShot)} target="_blank" rel="noopener noreferrer" className="block flex-1 overflow-hidden rounded-lg border border-border"><img src={mediaUrl(rd.mobileShot)} alt="Mobile screenshot" className="w-full" data-testid="img-mobile-shot" /></a>}
          </div>
          {m.brand && (
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              Brand colors
              {[m.brand.primary, m.brand.dark, m.brand.light].filter(Boolean).map((c: string) => <span key={c} className="inline-flex items-center gap-1 font-mono"><span className="size-3 rounded-sm border border-border" style={{ background: c }} />{c}</span>)}
            </div>
          )}
          {rd.fonts && <p className="mt-1 text-xs text-muted-foreground">Fonts: {rd.fonts.heading || "—"} / {rd.fonts.body || "—"}</p>}
        </Card>
      </div>

      {ai ? (
        <Card title={<span className="inline-flex items-center gap-2">AI assessment <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">{ai.via}</span></span>} right={<span className="text-sm font-semibold">{ai.verdict}</span>}>
          <p className="text-sm leading-relaxed text-muted-foreground">{ai.summary}</p>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            <div className="flex items-center gap-4 rounded-lg border border-border p-4">
              <ScoreRing value={ai.uiux?.score} size={64} />
              <div><p className="text-sm font-medium">UI / UX</p><p className="text-xs text-muted-foreground">{ai.uiux?.verdict}</p></div>
            </div>
            <div className="flex items-center gap-4 rounded-lg border border-border p-4">
              <ScoreRing value={ai.marketingReadiness?.score} size={64} />
              <div><p className="text-sm font-medium">Marketing readiness</p><p className="line-clamp-3 text-xs text-muted-foreground">{ai.marketingReadiness?.notes}</p></div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">Quick wins</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{(ai.quickWins || []).slice(0, 5).map((q: string) => <li key={q} className="flex gap-1.5"><span className="text-primary">→</span>{q}</li>)}</ul>
            </div>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div><p className="mb-2 text-xs font-medium uppercase tracking-wider text-ok">Strengths</p><ul className="space-y-1.5 text-sm">{(ai.uiux?.strengths || []).map((x: string) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-ok" />{x}</li>)}</ul></div>
            <div><p className="mb-2 text-xs font-medium uppercase tracking-wider text-bad">UI/UX problems</p><ul className="space-y-1.5 text-sm">{(ai.uiux?.problems || []).map((x: string) => <li key={x} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />{x}</li>)}</ul></div>
          </div>
        </Card>
      ) : r.lighthouse ? (
        <Card title="AI assessment"><p className="text-sm text-muted-foreground">{m.running ? "Reviewing your screenshot and measurements…" : "AI review unavailable for this run — check Settings → AI engine, then Re-check."}</p></Card>
      ) : null}

      {ai?.issues?.length > 0 && (
        <Card title={`Issues & fixes · ${ai.issues.length}`}>
          <div className="divide-y divide-border">
            {ai.issues.map((i: any, k: number) => (
              <div key={k} className="grid gap-2 py-3 md:grid-cols-[110px_1fr_1fr]" data-testid={`issue-${k}`}>
                <div className="flex items-start gap-2 md:flex-col"><Severity level={i.severity} /><span className="text-xs text-muted-foreground">{i.area}</span></div>
                <div><p className="text-sm font-medium">{i.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{i.detail}</p></div>
                <p className="rounded-md bg-muted/50 p-2.5 text-xs"><span className="font-medium text-primary">Fix: </span>{i.fix}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Speed opportunities">
          {lh?.opportunities?.length ? lh.opportunities.map((o: any) => (
            <div key={o.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-0">
              <span>{o.title}</span><span className="shrink-0 font-mono text-xs text-warn">−{(o.savingsMs / 1000).toFixed(1)}s</span>
            </div>
          )) : <p className="text-sm text-muted-foreground">No major opportunities flagged.</p>}
          {lh?.failed?.length > 0 && (
            <>
              <p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">Failed audits</p>
              {lh.failed.slice(0, 10).map((f: any) => <p key={f.id} className="py-1 text-xs text-muted-foreground"><span className="text-bad">✕</span> {f.title}</p>)}
            </>
          )}
        </Card>
        <Card title="SEO & sharing">
          <Check2 ok={!!s.title} label="Title tag" detail={s.title} />
          <Check2 ok={!!s.description} label="Meta description" detail={s.description} />
          <Check2 ok={(s.h1 || []).length === 1} label={`H1 headings: ${(s.h1 || []).length}`} />
          <Check2 ok={!!s.canonical} label="Canonical URL" detail={s.canonical} />
          <Check2 ok={!!s.ogImage} label="Open Graph image" />
          <Check2 ok={!!s.twitterCard} label="Twitter card" />
          <Check2 ok={!!s.robotsTxt} label="robots.txt" />
          <Check2 ok={!!s.sitemap} label="sitemap.xml" />
          <Check2 ok={(s.schemaTypes || []).length > 0} label="Structured data" detail={(s.schemaTypes || []).join(", ")} />
          <Check2 ok={!!s.lang} label="Language attribute" detail={s.lang} />
          <Check2 ok={s.imagesNoAlt === 0} label={`Images missing alt: ${s.imagesNoAlt}/${s.images}`} />
        </Card>
        <Card title="Server, security & UX">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            {[["HTTP status", s.status], ["TTFB", `${s.ttfbMs} ms`], ["HTML size", `${Math.round((s.htmlBytes || 0) / 1024)} KB`], ["Compression", s.compression], ["Requests", rd.requests ?? "—"], ["Transfer", rd.transferKb != null ? `${rd.transferKb} KB` : "—"], ["Console errors", rd.consoleErrors?.length ?? "—"], ["Broken links", `${s.brokenLinks?.length ?? 0}/${s.checkedLinks ?? 0}`]].map(([k, v]) => (
              <div key={k as string}><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="font-mono text-sm">{String(v ?? "—")}</dd></div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {Object.entries(s.securityHeaders || {}).map(([h, ok]: any) => <span key={h} className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", ok ? "border-ok/30 text-ok" : "border-bad/30 text-bad")}>{SEC_LABEL[h] || h}</span>)}
          </div>
          {rd.ux && (
            <div className="mt-4 border-t border-border pt-3">
              <Check2 ok={rd.ux.ctaAboveFold} label="Call-to-action above the fold" />
              <Check2 ok={!rd.ux.mobileOverflow} label="No horizontal scroll on mobile" />
              <Check2 ok={(rd.ux.smallTapTargets || 0) < 5} label={`Small tap targets: ${rd.ux.smallTapTargets ?? 0}`} />
              <Check2 ok={(rd.ux.smallText || 0) < 10} label={`Tiny text elements: ${rd.ux.smallText ?? 0}`} />
            </div>
          )}
          {s.tech?.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Stack: <span className="text-foreground">{s.tech.join(" · ")}</span></p>}
          {s.brokenLinks?.length > 0 && <div className="mt-2 space-y-0.5">{s.brokenLinks.slice(0, 5).map((b: any) => <p key={b.url} className="truncate font-mono text-[11px] text-bad">{b.status || "ERR"} {b.url}</p>)}</div>}
        </Card>
      </div>
    </div>
  );
}

function Ads({ m }: { m: any }) {
  const [pub, setPub] = useState<any>(null);
  const items = m.creatives as any[];
  if (!items.length) return <Empty title="No ads yet" body={m.running ? "Ads are produced after the audit and marketing brief." : "Run the mission to produce ads."} />;
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((c) => (
          <article key={c.id} className="overflow-hidden rounded-xl border border-border bg-card" data-testid={`card-ad-${c.id}`}>
            <div className="relative grid aspect-square place-items-center overflow-hidden bg-black">
              {c.videoFile ? (
                <video src={mediaUrl(c.videoFile)} poster={mediaUrl(c.posterFile)} controls loop muted playsInline preload="none" className="absolute inset-0 size-full object-contain" data-testid={`video-ad-${c.id}`} />
              ) : c.status === "rendering" ? (
                <div className="text-center text-sm text-muted-foreground"><div className="looi-shimmer mx-auto mb-3 h-1 w-32 rounded" />Rendering frames…</div>
              ) : <p className="text-sm text-bad">Render failed</p>}
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{c.format}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{c.template}</span>
                <span>cycle {c.cycle}</span>
                <span className={cn("ml-auto capitalize", c.status === "published" ? "text-ok" : c.status === "pending" ? "text-warn" : c.status === "rejected" || c.status === "failed" ? "text-bad" : "")}>{c.status}</span>
              </div>
              <p className="mt-2 font-display text-base font-bold leading-tight">{c.copy?.headline}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.copy?.sub}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">Angle: <span className="text-foreground">{c.angle}</span></p>
              {c.videoFile && (
                <div className="mt-3 flex gap-2">
                  <Button asChild size="sm" variant="secondary" className="flex-1"><a href={mediaUrl(c.videoFile, true)} data-testid={`button-download-${c.id}`}><Download className="size-4" /> MP4</a></Button>
                  <Button asChild size="sm" variant="ghost"><a href={mediaUrl(c.posterFile, true)} data-testid={`button-download-poster-${c.id}`}>Poster</a></Button>
                  <Button size="sm" onClick={() => setPub(c)} data-testid={`button-publish-${c.id}`}><Send className="size-4" /> Publish</Button>
                </div>
              )}
              {c.copy?.captions?.generic && <CopyBox text={c.copy.captions.generic.replace("{link}", m.url) + (c.copy.hashtags?.length ? "\n" + c.copy.hashtags.map((h: string) => "#" + h.replace(/^#/, "")).join(" ") : "")} />}
            </div>
          </article>
        ))}
      </div>
      <PublishDialog creative={pub} onClose={() => setPub(null)} />
    </>
  );
}

function CopyBox({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative mt-3 rounded-md bg-muted/50 p-2.5 pr-9 text-xs text-muted-foreground">
      <p className="line-clamp-3 whitespace-pre-line">{text}</p>
      <button className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" aria-label="Copy caption" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
        {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function PublishDialog({ creative, onClose }: { creative: any; onClose: () => void }) {
  const { toast } = useToast();
  const { data: channels = [] } = useQuery<any[]>({ queryKey: ["/api/channels"] });
  const [sel, setSel] = useState<number[]>([]);
  const go = useMutation({
    mutationFn: () => apiRequest("POST", `/api/creatives/${creative.id}/publish`, { channelIds: sel }),
    onSuccess: () => { toast({ title: "Publishing", description: "Progress shows in the pill at the top." }); queryClient.invalidateQueries({ queryKey: ["/api/live"] }); onClose(); },
    onError: (e: Error) => toast({ title: "Couldn't publish", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={!!creative} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish “{creative?.copy?.headline}”</DialogTitle></DialogHeader>
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No channels connected yet. <Link href="/app/channels" className="text-primary">Connect one</Link> — or download the MP4 and post it manually.</p>
        ) : (
          <div className="space-y-2">
            {channels.map((c) => (
              <label key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                <Checkbox checked={sel.includes(c.id)} onCheckedChange={(v) => setSel(v ? [...sel, c.id] : sel.filter((x) => x !== c.id))} data-testid={`checkbox-publish-${c.id}`} />
                {c.name}<span className={cn("ml-auto text-xs", c.status === "connected" ? "text-ok" : "text-bad")}>{c.status}</span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!sel.length || go.isPending} onClick={() => go.mutate()} data-testid="button-confirm-publish">Publish now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Publishing({ m }: { m: any }) {
  const pending = (m.approvals || []).filter((a: any) => a.status === "pending");
  return (
    <div className="space-y-5">
      {!m.tracking && (
        <div className="rounded-xl border border-warn/30 bg-warn/5 p-4 text-sm">
          <p className="font-medium">Click tracking is off</p>
          <p className="mt-0.5 text-muted-foreground">Set your server's public URL in <Link href="/app/settings" className="text-primary">Settings</Link> so posts carry tracked looi links and the strategist can measure clicks.</p>
        </div>
      )}
      {pending.length > 0 && <div className="rounded-xl border border-warn/30 bg-warn/5 p-4 text-sm"><p className="font-medium">{pending.length} batch waiting for your approval</p><Link href="/app/approvals" className="text-primary">Review approvals →</Link></div>}
      {m.posts.length === 0 ? <Empty title="Nothing published yet" body={m.channelIds?.length ? "Posts appear here once ads are approved and published." : "Connect a channel to let Looi auto-publish."}><Link href="/app/channels"><Button variant="secondary" size="sm">Manage channels</Button></Link></Empty> : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs text-muted-foreground"><tr>{["Channel", "Ad", "Status", "Published", "Clicks", "Metrics", ""].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {m.posts.map((p: any) => {
                const cr = m.creatives.find((c: any) => c.id === p.creativeId);
                return (
                  <tr key={p.id} className="border-t border-border" data-testid={`row-post-${p.id}`}>
                    <td className="px-4 py-3 capitalize">{p.channelType}</td>
                    <td className="max-w-[220px] truncate px-4 py-3">{cr?.copy?.headline || "—"}</td>
                    <td className={cn("px-4 py-3", p.status === "published" ? "text-ok" : p.status === "failed" ? "text-bad" : "text-muted-foreground")} title={p.error}>{p.status}{p.error && <span className="block max-w-[220px] truncate text-[11px]">{p.error}</span>}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.publishedAt ? timeAgo(p.publishedAt) : "—"}</td>
                    <td className="px-4 py-3 font-mono">{p.clicks}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{Object.entries(p.metrics || {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</td>
                    <td className="px-4 py-3">{p.externalUrl && <a href={p.externalUrl} target="_blank" rel="noopener noreferrer" className="text-primary"><ExternalLink className="size-4" /></a>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Analytics({ m }: { m: any }) {
  const snaps = (m.snapshots || []).map((s: any) => ({ t: new Date(s.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), cycle: s.cycle, ...s.data }));
  const days = Object.entries(m.clicksByDay || {}).map(([d, c]) => ({ d, c })).sort((a, b) => a.d.localeCompare(b.d));
  const st = m.strategy || {};
  const tip = { contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 } };
  return (
    <div className="space-y-5">
      {st.assessment && (
        <Card title={`Strategist · cycle ${st.cycle}`} right={<span className={cn("rounded-full px-2 py-0.5 font-mono text-[11px] uppercase", st.decision === "pivot" ? "bg-warn/15 text-warn" : st.decision === "scale" ? "bg-ok/15 text-ok" : "bg-primary/15 text-primary")}>{st.decision}</span>}>
          <p className="text-sm">{st.assessment}</p>
          <p className="mt-2 text-sm text-muted-foreground">{st.reasoning}</p>
          {st.newRoutes?.length > 0 && <div className="mt-4 grid gap-2 md:grid-cols-3">{st.newRoutes.map((r: any) => <div key={r.channel} className="rounded-lg border border-border p-3"><p className="text-sm font-medium">{r.channel}</p><p className="mt-0.5 text-xs text-muted-foreground">{r.why}</p></div>)}</div>}
          {st.siteFixes?.length > 0 && <div className="mt-4"><p className="text-xs font-medium uppercase tracking-wider text-warn">Site fixes blocking growth</p><ul className="mt-1 space-y-1 text-sm text-muted-foreground">{st.siteFixes.map((f: string) => <li key={f}>• {f}</li>)}</ul></div>}
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Health & performance over cycles">
          {snaps.length < 1 ? <p className="text-sm text-muted-foreground">Data appears after the first measurement.</p> : (
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={snaps} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <Tooltip {...tip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="health" name="Health" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="perf" name="Mobile perf" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Tracked clicks per day">
          {!m.tracking ? <p className="text-sm text-muted-foreground">Enable click tracking by setting a public URL in Settings.</p> : days.length === 0 ? <p className="text-sm text-muted-foreground">No clicks yet. They'll appear as soon as someone taps a Looi link.</p> : (
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={days} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="d" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <Tooltip {...tip} />
                  <Area dataKey="c" name="Clicks" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1) / .15)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
      {m.brief?.channelPlan?.length > 0 && (
        <Card title="Channel plan">
          <div className="grid gap-2 md:grid-cols-2">
            {m.brief.channelPlan.sort((a: any, b: any) => a.priority - b.priority).map((c: any) => (
              <div key={c.channel} className="flex gap-3 rounded-lg border border-border p-3"><span className="font-mono text-xs text-primary">P{c.priority}</span><div><p className="text-sm font-medium">{c.channel}</p><p className="text-xs text-muted-foreground">{c.why}</p></div></div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Playbooks({ m }: { m: any }) {
  const done = useMutation({ mutationFn: ({ id, d }: { id: number; d: boolean }) => apiRequest("POST", `/api/playbooks/${id}/done`, { done: d }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/missions", String(m.id)] }) });
  if (!m.playbooks.length) return <Empty title="No playbooks yet" body="For routes without a public API — Product Hunt, Reddit, Hacker News, cold email — Looi writes ready-to-paste launches here." />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {m.playbooks.map((p: any) => (
        <Card key={p.id} title={<span className="inline-flex items-center gap-2"><span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase">{p.channel.replace(/_/g, " ")}</span>{p.title}</span>} right={<label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Checkbox checked={p.status === "done"} onCheckedChange={(v) => done.mutate({ id: p.id, d: !!v })} data-testid={`checkbox-playbook-${p.id}`} />Done</label>}>
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{p.content}</div>
          <div className="mt-3 flex justify-end"><CopyBtn text={p.content} /></div>
        </Card>
      ))}
    </div>
  );
}
function CopyBtn({ text }: { text: string }) {
  const [d, setD] = useState(false);
  return <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(text); setD(true); setTimeout(() => setD(false), 1500); }}>{d ? <Check className="size-4" /> : <Copy className="size-4" />}{d ? "Copied" : "Copy"}</Button>;
}

function Log({ m }: { m: any }) {
  const color: Record<string, string> = { success: "text-ok", warn: "text-warn", error: "text-bad", decision: "text-primary", step: "text-muted-foreground", info: "text-foreground" };
  return (
    <div className="rounded-xl border border-border bg-card p-2 font-mono text-xs">
      {m.events.map((e: any) => (
        <div key={e.id} className="grid grid-cols-[70px_1fr] gap-3 rounded px-3 py-2 hover:bg-muted/40 md:grid-cols-[130px_1fr]" data-testid={`event-${e.id}`}>
          <span className="text-muted-foreground/70" title={new Date(e.ts).toLocaleString()}><Clock className="mr-1 inline size-3" />{new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<span className="hidden md:inline"> · {new Date(e.ts).toLocaleDateString([], { month: "short", day: "numeric" })}</span></span>
          <div className="min-w-0"><p className={color[e.kind] || ""}>{e.title}</p>{e.detail && <p className="mt-0.5 whitespace-pre-wrap break-words font-sans text-muted-foreground">{e.detail}</p>}</div>
        </div>
      ))}
    </div>
  );
}
