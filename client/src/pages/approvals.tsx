import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Empty, timeAgo } from "@/components/looi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient, mediaUrl } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export default function Approvals() {
  const { data = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/approvals"], refetchInterval: 8000, staleTime: 0 });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: string }) => apiRequest("POST", `/api/approvals/${id}/decide`, { decision }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live"] });
    },
  });
  const pending = data.filter((a) => a.status === "pending");
  const past = data.filter((a) => a.status !== "pending");
  return (
    <AppShell title="Approvals">
      <h1 className="font-display text-xl font-bold">Approvals</h1>
      <p className="mt-1 text-sm text-muted-foreground">In approval mode Looi asks before publishing. You can also approve from the pill at the top of any screen.</p>
      <div className="mt-6 space-y-4">
        {isLoading && <Skeleton className="h-48 rounded-xl" />}
        {!isLoading && pending.length === 0 && <Empty title="Nothing waiting" body="New ad batches that need your OK will show up here and in the top pill." />}
        {pending.map((a) => (
          <div key={a.id} className="rounded-xl border border-warn/30 bg-card p-5" data-testid={`card-approval-${a.id}`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <Link href={`/app/m/${a.missionId}`} className="text-xs text-muted-foreground hover:text-foreground">{a.missionName} · {timeAgo(a.createdAt)}</Link>
                <p className="mt-1 font-medium">{a.title}</p>
                {a.payload?.reason && <p className="mt-1 text-sm text-muted-foreground">{a.payload.reason}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => decide.mutate({ id: a.id, decision: "reject" })} disabled={decide.isPending} data-testid={`button-reject-${a.id}`}><X className="size-4" /> Reject</Button>
                <Button onClick={() => decide.mutate({ id: a.id, decision: "approve" })} disabled={decide.isPending} data-testid={`button-approve-${a.id}`}><Check className="size-4" /> Approve & publish</Button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {a.creatives.map((c: any) => (
                <div key={c.id} className="overflow-hidden rounded-lg border border-border">
                  <video src={mediaUrl(c.videoFile)} poster={mediaUrl(c.posterFile)} controls muted playsInline preload="none" className="aspect-square w-full bg-black object-contain" />
                  <p className="truncate p-2 text-xs">{c.copy?.headline}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        {past.length > 0 && (
          <div className="pt-6">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">History</p>
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {past.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className={cn("size-1.5 rounded-full", a.status === "approved" ? "bg-ok" : "bg-bad")} />
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  <span className="text-xs capitalize text-muted-foreground">{a.status} · {timeAgo(a.decidedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
