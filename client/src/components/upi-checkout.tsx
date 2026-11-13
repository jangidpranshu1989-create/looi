import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, ExternalLink, Loader2, MessageCircle, ShieldCheck, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Payment } from "@/lib/auth";
import { waLink } from "@/lib/config";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** Opens the UPI intent (GPay / PhonePe / Paytm / BHIM chooser) with payee, amount and note pre-filled. */
export function openUpi(url: string) {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  } catch {
    window.location.href = url;
  }
}

const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent) || !!(window as any).__LOOI__?.native;

function CopyChip({ value, label, testid }: { value: string; label: string; testid: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(value).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left hover:border-primary/50"
      data-testid={testid}
    >
      <span className="min-w-0">
        <span className="block text-[11px] text-muted-foreground">{label}</span>
        <span className="block truncate font-mono text-sm">{value}</span>
      </span>
      {done ? <Check className="size-4 shrink-0 text-ok" /> : <Copy className="size-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/** UPI checkout: exact-amount deep link / QR → user pastes the 12-digit UTR → we verify and switch the plan on. */
export function UpiCheckout({
  order,
  onClose,
  submitUtr,
  autoOpen,
}: {
  order: Payment | null;
  onClose: () => void;
  /** Custom UTR submit (Looi Free relay). Defaults to the Looi Cloud API. */
  submitUtr?: (orderId: string, utr: string) => Promise<{ provisional: boolean; payment: Payment }>;
  /** On phones, jump straight into the UPI app with everything pre-filled. */
  autoOpen?: boolean;
}) {
  const { toast } = useToast();
  const [qr, setQr] = useState("");
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { provisional: boolean; payment: Payment }>(null);
  const mobile = isMobile();

  useEffect(() => {
    setUtr("");
    setDone(null);
    if (order) QRCode.toDataURL(order.upiUrl, { margin: 1, width: 440, color: { dark: "#0b0b0d", light: "#ffffff" } }).then(setQr);
    if (order && autoOpen && isMobile()) setTimeout(() => openUpi(order.upiUrl), 150);
  }, [order?.orderId]);

  if (!order) return null;
  const planLabel = order.plan === "scale" ? "Scale" : "Pro";
  const validUtr = /^\d{12}$/.test(utr);

  async function submit() {
    setBusy(true);
    try {
      const r = submitUtr ? await submitUtr(order!.orderId, utr) : await (await apiRequest("POST", "/api/billing/utr", { orderId: order!.orderId, utr })).json();
      setDone({ provisional: r.provisional, payment: r.payment });
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/history"] });
    } catch (e) {
      toast({ title: "Couldn't submit UTR", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }
  const waText = `Hi Looi team, I paid ₹${order.amountInr} for ${planLabel}. Order ${order.orderId}${utr ? `, UTR ${utr}` : ""}.`;

  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md" data-testid="dialog-upi">
        {done ? (
          <div className="py-2 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/15">
              <Check className="size-6 text-primary" />
            </div>
            <DialogTitle className="mt-4 font-display text-xl">{done.provisional ? `${planLabel} is on` : "Payment submitted"}</DialogTitle>
            <DialogDescription className="mt-2">
              {done.provisional
                ? `We've switched ${planLabel} on right away while we match UTR ${done.payment.utr} with our UPI statement (usually within a few hours). You'll get a notification once it's confirmed.`
                : `We're matching UTR ${done.payment.utr} with our UPI statement. ${planLabel} switches on as soon as it's verified, usually within a few hours.`}
            </DialogDescription>
            <div className="mt-5 flex flex-col gap-2">
              <Button onClick={onClose} data-testid="button-upi-done">Done</Button>
              <Button variant="ghost" asChild>
                <a href={waLink(`Hi Looi team, I paid ₹${order.amountInr} for ${planLabel}. Order ${order.orderId}, UTR ${done.payment.utr}.`)} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" /> Need it faster? WhatsApp us
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-xl">Pay ₹{order.amountInr} by UPI</DialogTitle>
              <DialogDescription>
                {planLabel} plan · 30 days · no auto-debit. Please pay this <b className="text-foreground">exact amount</b>, the paise help us match your payment instantly.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step 1 · Pay</p>
                {mobile && (
                  <Button className="mt-3 w-full" size="lg" asChild data-testid="button-open-upi">
                    <a href={order.upiUrl} onClick={(e) => { e.preventDefault(); openUpi(order.upiUrl); }}>
                      <Smartphone className="size-4" /> Pay ₹{order.amountInr} with any UPI app
                    </a>
                  </Button>
                )}
                <div className={cn("flex flex-col items-center", mobile ? "mt-4" : "mt-3")}>
                  {qr ? <img src={qr} alt={`UPI QR for ₹${order.amountInr}`} className="size-48 rounded-lg bg-white p-2" data-testid="img-upi-qr" /> : <div className="size-48 animate-pulse rounded-lg bg-muted" />}
                  <p className="mt-2 text-xs text-muted-foreground">{mobile ? "Or scan from another phone" : "Scan with GPay, PhonePe, Paytm, BHIM or any UPI app"}</p>
                </div>
                <div className="mt-3 grid gap-2">
                  <CopyChip value={order.vpa} label="UPI ID" testid="copy-vpa" />
                  <div className="grid grid-cols-2 gap-2">
                    <CopyChip value={order.amountInr} label="Exact amount (₹)" testid="copy-amount" />
                    <CopyChip value={order.orderId} label="Note / reference" testid="copy-ref" />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step 2 · Confirm</p>
                <label htmlFor="utr" className="mt-3 block text-sm font-medium">UTR / UPI Ref No.</label>
                <Input
                  id="utr"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="e.g. 431298765012"
                  value={utr}
                  onChange={(e) => setUtr(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  className="mt-1.5 font-mono tracking-wider"
                  data-testid="input-utr"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">Open the payment in your UPI app's history. It's listed as UTR, UPI Ref No. or UPI transaction ID.</p>
                <Button className="mt-3 w-full" disabled={!validUtr || busy} onClick={submit} data-testid="button-submit-utr">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} I've paid · verify
                </Button>
              </div>

              <a href={waLink(waText)} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <MessageCircle className="size-3.5" /> Problem paying? WhatsApp +91 85294 18454 <ExternalLink className="size-3" />
              </a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
