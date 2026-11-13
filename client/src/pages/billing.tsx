import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, Gauge, Clapperboard, Rocket, ShieldCheck, LogOut, Trash2, KeyRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PricingCards } from "@/components/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMe, daysLeft, setToken, type PlanInfo } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SUPPORT_EMAIL } from "@/lib/config";

declare global {
  interface Window {
    Razorpay?: any;
  }
}
function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => res();
    s.onerror = () => rej(new Error("Couldn't load Razorpay checkout. Check your connection."));
    document.body.appendChild(s);
  });
}

function Meter({ icon: Icon, label, used, max }: { icon: any; label: string; used: number; max: number }) {
  const unlimited = max >= 1e8;
  const pct = unlimited ? 4 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid={`meter-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5" /> {label}
        </span>
        <span className="font-mono">{unlimited ? "∞" : `${used} / ${max.toLocaleString("en-IN")}`}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", pct >= 90 ? "bg-bad" : pct >= 70 ? "bg-warn" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Billing() {
  const { data: me, isLoading } = useMe();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const [busy, setBusy] = useState("");
  const u = me?.user;

  async function choose(p: PlanInfo) {
    if (p.key === "free") return;
    if (!me?.payments) {
      toast({ title: "Payments open soon", description: `Write to ${SUPPORT_EMAIL} and we'll switch on ${p.label} for you.` });
      return;
    }
    setBusy(p.key);
    try {
      await loadRazorpay();
      const o = await (await apiRequest("POST", "/api/billing/order", { plan: p.key })).json();
      const rzp = new window.Razorpay({
        key: o.keyId,
        order_id: o.orderId,
        amount: o.amount,
        currency: o.currency,
        name: "Looi",
        description: `${o.name} plan · 30 days`,
        prefill: { email: o.email, name: o.userName },
        theme: { color: "#7c6cf0" },
        handler: async (r: any) => {
          try {
            await apiRequest("POST", "/api/billing/verify", r);
            await queryClient.invalidateQueries({ queryKey: ["/api/me"] });
            toast({ title: `Welcome to ${o.name}`, description: "Your agent now has more room to work." });
          } catch (e) {
            toast({ title: "Payment received, activation pending", description: (e as Error).message, variant: "destructive" });
          }
        },
        modal: { ondismiss: () => setBusy("") },
      });
      rzp.on("payment.failed", (r: any) => toast({ title: "Payment failed", description: r?.error?.description || "Try another method.", variant: "destructive" }));
      rzp.open();
    } catch (e) {
      toast({ title: "Couldn't open checkout", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy("");
    }
  }

  const logout = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/logout"),
    onSettled: () => {
      setToken("");
      queryClient.clear();
      nav("/login");
    },
  });

  return (
    <AppShell title="Billing & account">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">Plan & usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">Looi AI, site audits and ad rendering are included. You never need your own API keys.</p>
        </div>
      </div>

      {isLoading || !u ? (
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
      ) : (
        <>
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_2fr]">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
              <div className="hero-glow pointer-events-none absolute inset-0 opacity-70" />
              <div className="relative">
                <p className="text-xs text-muted-foreground">Current plan</p>
                <p className="mt-1 font-display text-3xl font-extrabold" data-testid="text-plan">
                  {u.plan.label}
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CalendarClock className="size-4" />
                  {u.plan.key === "trial"
                    ? `${daysLeft(u.trialEndsAt)} day${daysLeft(u.trialEndsAt) === 1 ? "" : "s"} left in your trial`
                    : u.plan.key === "free"
                      ? `Allowance resets in ${daysLeft(u.periodEnd)} days`
                      : u.plan.key === "unlimited"
                        ? "Admin account"
                        : `Renews manually · active until ${new Date(u.paidUntil).toLocaleDateString()}`}
                </p>
                {u.plan.key === "trial" && <p className="mt-3 text-xs text-muted-foreground">After the trial you move to Free automatically. Nothing is charged.</p>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Meter icon={Rocket} label="Active missions" used={u.usage.missions} max={u.plan.missions} />
              <Meter icon={Gauge} label="Site audits" used={u.usage.audits} max={u.plan.audits} />
              <Meter icon={Clapperboard} label="Video ads" used={u.usage.creatives} max={u.plan.creatives} />
            </div>
          </div>

          <h2 className="mt-12 font-display text-xl font-bold">Upgrade</h2>
          <p className="mt-1 text-sm text-muted-foreground">Pay monthly with UPI, cards or netbanking. No auto-debit; renew when you want.</p>
          <div className="mt-6">
            <PricingCards plans={me?.plans} current={u.plan.key === "trial" ? "" : u.plan.key} trialDays={me?.trialDays} onChoose={choose} busy={busy} />
          </div>

          <h2 className="mt-12 font-display text-xl font-bold">Account</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="mt-1 font-medium" data-testid="text-email">
                {u.email}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => logout.mutate()} data-testid="button-logout">
                  <LogOut className="size-4" /> Sign out
                </Button>
              </div>
              <PasswordChange />
            </div>
            <DeleteAccount onDeleted={() => (setToken(""), queryClient.clear(), nav("/"))} />
          </div>
          <p className="mt-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Payments are processed by Razorpay. Looi never sees your card or UPI details.
          </p>
        </>
      )}
    </AppShell>
  );
}

function PasswordChange() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const m = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/password", { current: cur, password: next }),
    onSuccess: () => (toast({ title: "Password updated", description: "Other devices were signed out." }), setOpen(false), setCur(""), setNext("")),
    onError: (e: Error) => toast({ title: "Couldn't update password", description: e.message, variant: "destructive" }),
  });
  if (!open)
    return (
      <button className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary" onClick={() => setOpen(true)} data-testid="button-change-password">
        <KeyRound className="size-4" /> Change password
      </button>
    );
  return (
    <form className="mt-4 space-y-2" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
      <Input type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" data-testid="input-current-password" />
      <Input type="password" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} data-testid="input-new-password" />
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={m.isPending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const { toast } = useToast();
  const [pw, setPw] = useState("");
  const [open, setOpen] = useState(false);
  const m = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/delete", { password: pw }),
    onSuccess: () => (toast({ title: "Account deleted" }), onDeleted()),
    onError: (e: Error) => toast({ title: "Couldn't delete account", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Trash2 className="size-4 text-bad" /> Delete account
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Removes your missions, ads, plugins and history from Looi permanently.</p>
      {!open ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setOpen(true)} data-testid="button-delete-account">
          Delete my account
        </Button>
      ) : (
        <form className="mt-4 space-y-2" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <Input type="password" placeholder="Confirm with your password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="input-delete-password" />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" type="submit" disabled={!pw || m.isPending} data-testid="button-confirm-delete">
              Delete forever
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

