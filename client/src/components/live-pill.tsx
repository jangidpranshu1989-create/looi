import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, X, ArrowUpRight, Bell } from "lucide-react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, mediaUrl } from "@/lib/queryClient";
import { LooiMark, useLive, timeAgo } from "./looi";
import { cn } from "@/lib/utils";

export function notifyNative(title: string, body: string) {
  try {
    const anyWin = window as any;
    if (anyWin.__LOOI__?.native && anyWin.Capacitor?.Plugins?.LocalNotifications) {
      anyWin.Capacitor.Plugins.LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 1e6), title, body }] });
      return;
    }
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, icon: "./favicon.svg" });
  } catch {}
}

/** Dynamic-Island style pill pinned to the top-center of every app screen. */
export function LivePill() {
  const { data } = useLive();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<any>(null);
  const lastId = useRef<number | null>(null);

  useEffect(() => {
    const n = data?.latest;
    if (!n) return;
    if (lastId.current === null) {
      lastId.current = n.id;
      return;
    }
    if (n.id !== lastId.current) {
      lastId.current = n.id;
      setFlash(n);
      notifyNative(n.title, n.body);
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      const t = setTimeout(() => setFlash(null), 6000);
      return () => clearTimeout(t);
    }
  }, [data?.latest?.id]);

  // refresh mission detail while jobs are running
  const runningKey = (data?.jobs || []).map((j) => `${j.missionId}:${j.stage}`).join("|");
  useEffect(() => {
    for (const j of data?.jobs || []) queryClient.invalidateQueries({ queryKey: ["/api/missions", String(j.missionId)] });
    if (data?.jobs) queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
  }, [runningKey]);

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: string }) => apiRequest("POST", `/api/approvals/${id}/decide`, { decision }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/live"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
    },
  });

  const jobs = data?.jobs || [];
  const approvals = data?.approvals || [];
  const job = jobs[0];
  const visible = !!job || approvals.length > 0 || !!flash || (data?.queued?.length ?? 0) > 0;

  let label = "";
  let tone: "run" | "approve" | "flash" = "run";
  if (job) label = `${job.name} · ${job.stage}`;
  else if (approvals.length) {
    label = `${approvals.length} approval${approvals.length > 1 ? "s" : ""} needed`;
    tone = "approve";
  } else if (flash) {
    label = flash.title;
    tone = "flash";
  } else if (data?.queued?.length) label = `${data.queued[0].name} · queued`;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center pt-safe">
      <AnimatePresence>
        {visible && (
          <motion.div
            layout
            initial={{ y: -40, opacity: 0, scale: 0.9 }}
            animate={{ y: 10, opacity: 1, scale: 1 }}
            exit={{ y: -40, opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={cn(
              "pointer-events-auto overflow-hidden border border-white/10 bg-black text-white shadow-[0_18px_50px_-12px_rgba(0,0,0,.9)]",
              open ? "w-[min(420px,calc(100vw-24px))] rounded-[26px]" : "max-w-[calc(100vw-24px)] rounded-full",
            )}
            data-testid="live-pill"
          >
            <button className="flex w-full items-center gap-2.5 py-1.5 pl-1.5 pr-3 text-left" onClick={() => setOpen((o) => !o)} data-testid="button-live-pill-toggle" aria-expanded={open}>
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", tone === "approve" ? "bg-warn/20" : "bg-white/[.07]")}>
                {tone === "approve" ? <Bell className="size-3.5 text-warn" /> : <LooiMark className="size-5" spinning={!!job} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium" data-testid="text-live-label">
                {label}
              </span>
              {job && <span className="font-mono text-xs text-primary tabular">{job.progress}%</span>}
              {jobs.length + (data?.queued?.length || 0) > 1 && <span className="rounded-full bg-white/10 px-1.5 font-mono text-[10px]">+{jobs.length + (data?.queued?.length || 0) - 1}</span>}
              <ChevronDown className={cn("size-3.5 shrink-0 text-white/50 transition-transform", open && "rotate-180")} />
            </button>
            {job && !open && (
              <div className="mx-4 mb-1.5 h-[2px] overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full bg-primary" animate={{ width: `${job.progress}%` }} />
              </div>
            )}
            <AnimatePresence initial={false}>
              {open && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-4 pb-4">
                  {jobs.map((j) => (
                    <div key={j.missionId} className="mt-2 rounded-2xl bg-white/[.05] p-3">
                      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-white/60">
                        <span className="truncate">
                          {j.name} · {j.kind === "launch" ? "Launch" : j.kind === "check" ? "Re-check" : j.kind}
                        </span>
                        <span className="shrink-0 font-mono">{timeAgo(j.startedAt).replace(" ago", "")}</span>
                      </div>
                      <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
                        <motion.div className="h-full bg-primary" animate={{ width: `${j.progress}%` }} />
                      </div>
                      <ol className="space-y-1.5">
                        {j.steps.map((s, i) => {
                          const current = !s.done && (i === 0 || j.steps[i - 1].done);
                          return (
                            <li key={s.label} className={cn("flex items-center gap-2 text-[13px]", s.done ? "text-white/50" : current ? "text-white" : "text-white/30")}>
                              <span className={cn("grid size-4 place-items-center rounded-full border", s.done ? "border-primary bg-primary text-black" : current ? "border-primary" : "border-white/20")}>
                                {s.done ? <Check className="size-2.5" strokeWidth={3} /> : current ? <span className="size-1.5 rounded-full bg-primary looi-pulse" /> : null}
                              </span>
                              {s.label}
                            </li>
                          );
                        })}
                      </ol>
                      <Link href={`/app/m/${j.missionId}`} onClick={() => setOpen(false)} className="mt-3 inline-flex items-center gap-1 text-xs text-primary" data-testid={`link-live-mission-${j.missionId}`}>
                        Open mission <ArrowUpRight className="size-3" />
                      </Link>
                    </div>
                  ))}
                  {approvals.slice(0, 3).map((a) => (
                    <div key={a.id} className="mt-2 rounded-2xl bg-white/[.05] p-3" data-testid={`card-pill-approval-${a.id}`}>
                      <p className="text-[13px] font-medium">{a.title}</p>
                      <p className="mt-0.5 line-clamp-3 text-xs text-white/50">{a.payload?.summary || "Review before Looi publishes."}</p>
                      {a.payload?.posters?.length > 0 && (
                        <div className="mt-2 flex gap-1.5">
                          {a.payload.posters.slice(0, 4).map((p: string) => (
                            <img key={p} src={mediaUrl(p)} alt="" className="h-14 w-14 rounded-lg object-cover" />
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button className="flex-1 rounded-full bg-primary py-1.5 text-xs font-semibold text-black" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, decision: "approve" })} data-testid={`button-pill-approve-${a.id}`}>
                          Approve & publish
                        </button>
                        <button className="rounded-full bg-white/10 px-3 py-1.5 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, decision: "reject" })} data-testid={`button-pill-reject-${a.id}`}>
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {flash && !jobs.length && !approvals.length && (
                    <div className="mt-2 rounded-2xl bg-white/[.05] p-3 text-[13px]">
                      <p className="font-medium">{flash.title}</p>
                      <p className="mt-0.5 text-xs text-white/60">{flash.body}</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
