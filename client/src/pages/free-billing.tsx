import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Check, Clapperboard, Loader2, Mail, MessageCircle, Sparkles, Zap } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { UpiCheckout } from "@/components/upi-checkout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient } from "@/lib/queryClient";
import { relayJson, type RelayBilling, type RelayPlan } from "@/lib/relay";
import type { Payment } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY, waLink } from "@/lib/config";

const BLURB: Record<string, string> = {
  free: "Everything Looi does, with a fair daily limit.",
  pro: "For founders who want Looi pushing all day.",
  scale: "For agencies running many products.",
};
const days = (ts?: number) => (ts ? Math.max(0, Math.ceil((ts - Date.now()) / 86_400_000)) : 0);

/** Upgrade screen for Looi Free (device mode + Cloudflare relay). One tap opens the UPI app with everything pre-filled. */
export default function FreeBilling() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<RelayBilling>({ queryKey: ["relay", "pay"], queryFn: () => relayJson("/relay/pay/plans"), staleTime: 10_000 });
  const [order, setOrder] = useState<Payment | null>(null);
  const [busy, setBusy] = useState("");
  const cur = data?.current;

  async function pay(p: RelayPlan) {
    setBusy(p.key);
    try {
      setOrder(await relayJson<Payment>("/relay/pay/order", { plan: p.key }));
    } catch (e) {
      toast({ title: "Couldn't start the payment", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy("");
    }
  }
  const last = data?.last as (Payment & { status: string }) | null;

  return (
    <AppShell title="Upgrade">
      <h1 className="font-display text-xl font-bold">Plan</h1>
      <p className="mt-1 text-sm text-muted-foreground">Looi is free. Pro raises the daily Looi AI and public-link limits on this device. Pay once by UPI, 30 days, no auto-debit.</p>

      {isLoading || !data ? (
        <div className="mt-6 grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div>
      ) : (
        <>
          <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4" data-testid="card-current-plan">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary"><BadgeCheck className="size-5" /></span>
              <div>
                <p className="text-sm font-semibold">{cur?.label} plan{cur?.status === "provisional" ? " · confirming payment" : ""}</p>
                <p className="text-xs text-muted-foreground">
                  {cur?.key === "free" ? `${cur.ai} Looi AI calls and ${cur.media} public links per day` : `${days(cur?.until)} days left · ${cur?.ai.toLocaleString("en-IN")} AI calls / day`}
                </p>
              </div>
            </div>
            {last && last.status === "rejected" && <p className="text-xs text-bad">Last payment {last.orderId} couldn't be matched. WhatsApp us with the UTR.</p>}
          </section>

          <div className="mt-4 grid gap-3 md:grid-cols-3" data-testid="free-pricing">
            {data.plans.map((p) => {
              const active = cur?.key === p.key;
              const hot = p.key === "pro";
              return (
                <div key={p.key} className={cn("flex flex-col rounded-2xl border bg-card p-5", hot ? "border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]" : "border-border")} data-testid={`plan-${p.key}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-lg font-bold">{p.label}</p>
                    {hot && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">Popular</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{BLURB[p.key]}</p>
                  <p className="mt-4 font-display text-3xl font-bold">{p.inr ? `₹${p.inr.toLocaleString("en-IN")}` : "₹0"}<span className="ml-1 text-sm font-normal text-muted-foreground">{p.inr ? "/ 30 days" : "forever"}</span></p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {[
                      [Zap, `${p.ai.toLocaleString("en-IN")} Looi AI calls / day`],
                      [Clapperboard, `${p.media.toLocaleString("en-IN")} public ad links / day (Instagram, Facebook)`],
                      [Check, "Unlimited missions, audits and ads"],
                      [Check, "24/7 background agent on your phone"],
                      [Check, "One-click plugins, NIM → Groq failover"],
                    ].map(([I, s]: any) => (
                      <li key={s} className="flex items-start gap-2"><I className="mt-0.5 size-4 shrink-0 text-primary" />{s}</li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-5">
                    {p.key === "free" ? (
                      <Button variant="secondary" className="w-full" disabled>{active ? "Current plan" : "Included"}</Button>
                    ) : (
                      <Button className="w-full" size="lg" variant={hot ? "default" : "secondary"} onClick={() => pay(p)} disabled={!!busy} data-testid={`button-pay-${p.key}`}>
                        {busy === p.key ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                        {active ? `Extend ${p.label} · ₹${p.inr}` : `Pay ₹${p.inr.toLocaleString("en-IN")} by UPI`}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">On your phone, the button opens GPay, PhonePe, Paytm or any UPI app with the UPI ID ({data.vpa}), exact amount and note filled in — just confirm. On a computer, scan the QR.</p>

          <section className="mt-6 grid gap-3 sm:grid-cols-2">
            <a href={waLink("Hi Looi team, I need help with my plan.")} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover-elevate">
              <MessageCircle className="size-5 text-primary" />
              <div><p className="text-sm font-medium">WhatsApp</p><p className="text-xs text-muted-foreground">{SUPPORT_PHONE_DISPLAY}</p></div>
            </a>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover-elevate">
              <Mail className="size-5 text-primary" />
              <div><p className="text-sm font-medium">Email</p><p className="text-xs text-muted-foreground">{SUPPORT_EMAIL}</p></div>
            </a>
          </section>
        </>
      )}

      <UpiCheckout
        order={order}
        autoOpen
        onClose={() => { setOrder(null); queryClient.invalidateQueries({ queryKey: ["relay", "pay"] }); }}
        submitUtr={async (orderId, utr) => {
          const r = await relayJson<{ provisional: boolean; payment: Payment }>("/relay/pay/utr", { orderId, utr });
          queryClient.invalidateQueries({ queryKey: ["relay", "pay"] });
          return r;
        }}
      />
    </AppShell>
  );
}
