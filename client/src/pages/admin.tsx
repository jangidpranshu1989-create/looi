import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, MessageCircle, RefreshCw, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMe, type Payment } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Stats { users: number; newUsers7d: number; active7d: number; paying: number; provisional?: number; pendingPayments: number; revenue30dInr: number; revenueAllInr: number; missions: number; activeMissions: number; ads: number; posts: number }

/** Admin: match submitted UTRs with the UPI app statement, then approve or reject. */
export default function AdminPage() {
  const { data: me } = useMe();
  const { toast } = useToast();
  const [tab, setTab] = useState<"submitted" | "all">("submitted");
  const stats = useQuery<Stats>({ queryKey: ["/api/admin/stats"], enabled: !!me?.user?.admin });
  const list = useQuery<Payment[]>({ queryKey: [`/api/admin/payments?status=${tab}`], enabled: !!me?.user?.admin, refetchInterval: 30_000 });
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: "approve" | "reject"; reason?: string }) => apiRequest("POST", `/api/admin/payments/${id}/${action}`, { reason }),
    onSuccess: (_r, v) => {
      toast({ title: v.action === "approve" ? "Payment verified, plan activated" : "Payment rejected, user notified" });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin") });
    },
    onError: (e: Error) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });

  if (me && !me.user?.admin)
    return (
      <AppShell title="Admin">
        <p className="text-sm text-muted-foreground">Admins only.</p>
      </AppShell>
    );
  const s = stats.data;
  return (
    <AppShell title="Admin">
      <h1 className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">Admin</h1>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Users", s?.users, `+${s?.newUsers7d ?? 0} this week`],
          ["Paying (verified)", s?.paying, `+${s?.provisional ?? 0} provisional · ${s?.active7d ?? 0} active this week`],
          ["Revenue · 30 days", s ? `₹${s.revenue30dInr.toLocaleString("en-IN")}` : undefined, s ? `₹${s.revenueAllInr.toLocaleString("en-IN")} all time` : ""],
          ["To verify", s?.pendingPayments, `${s?.activeMissions ?? 0} live missions · ${s?.ads ?? 0} ads`],
        ].map(([k, v, sub]) => (
          <div key={String(k)} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-1 font-display text-2xl font-bold">{v ?? "–"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">UPI payments</h2>
          <p className="mt-1 text-sm text-muted-foreground">Open your UPI app (FamPay) history, find the exact amount, match the UTR, then approve.</p>
        </div>
        <div className="flex gap-2">
          {(["submitted", "all"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "secondary"} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
              {t === "submitted" ? "To verify" : "All"}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => list.refetch()} aria-label="Refresh">
            <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {list.isLoading && <Skeleton className="h-24 w-full rounded-xl" />}
        {list.data?.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing to verify right now.</p>}
        {list.data?.map((p) => (
          <PaymentRow key={p.id} p={p} busy={act.isPending} onApprove={() => act.mutate({ id: p.id, action: "approve" })} onReject={(reason) => act.mutate({ id: p.id, action: "reject", reason })} />
        ))}
      </div>
    </AppShell>
  );
}

function PaymentRow({ p, busy, onApprove, onReject }: { p: Payment; busy: boolean; onApprove: () => void; onReject: (r: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("No payment with this UTR and amount was found.");
  const open = p.status === "submitted";
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid={`admin-payment-${p.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-2xl font-bold">₹{p.amountInr}</p>
          <p className="text-sm">
            {p.plan === "scale" ? "Scale" : "Pro"} · {p.email}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
            UTR <b className="text-foreground">{p.utr}</b>
            <button onClick={() => navigator.clipboard?.writeText(p.utr)} aria-label="Copy UTR">
              <Copy className="size-3" />
            </button>
            · {p.orderId} · {new Date(p.utrAt || p.createdAt).toLocaleString()}
          </p>
          {p.provisional && open && <p className="mt-1 text-xs text-warn">Has provisional access until verified (max 48 h).</p>}
          {p.note && !open && <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>}
        </div>
        {open ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={onApprove} disabled={busy} data-testid={`button-approve-${p.id}`}>
              <Check className="size-4" /> Verified
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRejecting((v) => !v)} disabled={busy} data-testid={`button-reject-${p.id}`}>
              <X className="size-4" /> Not found
            </Button>
          </div>
        ) : (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", p.status === "paid" ? "bg-primary/15 text-primary" : "bg-[hsl(var(--bad)/0.15)] text-bad")}>{p.status === "paid" ? "Verified" : "Rejected"}</span>
        )}
      </div>
      {rejecting && open && (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => (e.preventDefault(), onReject(reason), setRejecting(false))}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="min-w-[240px] flex-1" />
          <Button size="sm" variant="destructive" type="submit">
            Reject & notify
          </Button>
        </form>
      )}
      {open && (
        <a href={`https://wa.me/?text=${encodeURIComponent(`Looi payment check: ₹${p.amountInr} UTR ${p.utr} (${p.email})`)}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <MessageCircle className="size-3" /> Share details
        </a>
      )}
    </div>
  );
}
