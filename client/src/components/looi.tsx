import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/lib/auth";
import { isDeviceMode } from "@/lib/queryClient";

export function LooiMark({ className = "size-6", spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-label="Looi" role="img" fill="none">
      <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="3.4" className="text-primary" />
      <g className={spinning ? "looi-orbit" : ""} style={{ transformOrigin: "16px 16px" }}>
        <circle cx="23.2" cy="8.8" r="3.6" className="fill-primary" stroke="hsl(var(--background))" strokeWidth="2" />
      </g>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LooiMark className="size-6" />
      <span className="font-display text-lg font-extrabold tracking-tight">looi</span>
    </span>
  );
}

export const scoreTone = (n?: number | null) => (n == null ? "text-muted-foreground" : n >= 90 ? "text-ok" : n >= 50 ? "text-warn" : "text-bad");
export const scoreStroke = (n?: number | null) => (n == null ? "hsl(var(--muted-foreground))" : n >= 90 ? "hsl(var(--ok))" : n >= 50 ? "hsl(var(--warn))" : "hsl(var(--bad))");

export function ScoreRing({ value, label, size = 76, testId }: { value?: number | null; label?: string; size?: number; testId?: string }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <div className="flex flex-col items-center gap-2" data-testid={testId}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--muted))" strokeWidth="5" fill="none" />
          <circle cx={size / 2} cy={size / 2} r={r} stroke={scoreStroke(value)} strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * v) / 100} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)" }} />
        </svg>
        <span className={cn("absolute inset-0 grid place-items-center font-mono text-lg font-semibold", scoreTone(value))}>{value == null ? "–" : value}</span>
      </div>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}

export function timeAgo(ts?: number) {
  if (!ts) return "—";
  const d = Date.now() - ts;
  const abs = Math.abs(d);
  const fut = d < 0;
  const m = Math.round(abs / 60000);
  let s: string;
  if (m < 1) s = "just now";
  else if (m < 60) s = `${m}m`;
  else if (m < 60 * 24) s = `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + "m" : ""}`.trim();
  else s = `${Math.floor(m / 1440)}d`;
  if (s === "just now") return s;
  return fut ? `in ${s}` : `${s} ago`;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-muted-foreground" },
  running: { label: "Working", cls: "bg-primary looi-pulse" },
  active: { label: "Monitoring", cls: "bg-ok" },
  paused: { label: "Paused", cls: "bg-warn" },
  failed: { label: "Failed", cls: "bg-bad" },
};
export function StatusPill({ status, testId }: { status: string; testId?: string }) {
  const s = STATUS[status] || STATUS.queued;
  return (
    <span data-testid={testId} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", s.cls)} />
      {s.label}
    </span>
  );
}

const SEV: Record<string, string> = {
  critical: "bg-bad/15 text-bad border-bad/30",
  high: "bg-warn/15 text-warn border-warn/30",
  medium: "bg-[hsl(var(--chart-2)/.12)] text-[hsl(var(--chart-2))] border-[hsl(var(--chart-2)/.3)]",
  low: "bg-muted text-muted-foreground border-border",
};
export function Severity({ level }: { level: string }) {
  return <span className={cn("inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", SEV[level] || SEV.low)}>{level}</span>;
}

export function Favicon({ src, name, className = "size-8" }: { src?: string; name?: string; className?: string }) {
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted font-display text-sm font-bold uppercase", className)}>
      <span>{(name || "?").slice(0, 1)}</span>
      {src && <img src={src} alt="" className="absolute inset-0 size-full bg-muted object-contain p-1" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />}
    </span>
  );
}

export type LiveJob = { missionId: number; name: string; favicon: string; kind: string; stage: string; progress: number; startedAt: number; steps: { label: string; done: boolean }[] };
export type LiveState = { jobs: LiveJob[]; queued: { missionId: number; name: string }[]; approvals: any[]; unread: number; latest: any; now: number };

export function useLive() {
  const { data: me } = useMe();
  const enabled = isDeviceMode() || (!!me && (!me.saas || !!me.user));
  return useQuery<LiveState>({ queryKey: ["/api/live"], refetchInterval: enabled ? 2000 : false, staleTime: 0, enabled });
}

export function Empty({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <LooiMark className="mb-4 size-8 opacity-60" />
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
