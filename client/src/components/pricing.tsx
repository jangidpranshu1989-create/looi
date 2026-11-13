import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inr, type PlanInfo } from "@/lib/auth";

const DEFAULT_PLANS: PlanInfo[] = [
  { key: "free", label: "Free", priceInr: 0, missions: 1, audits: 2, creatives: 6, minInterval: 720, autopilot: false },
  { key: "pro", label: "Pro", priceInr: 999, missions: 5, audits: 40, creatives: 200, minInterval: 120, autopilot: true },
  { key: "scale", label: "Scale", priceInr: 2999, missions: 25, audits: 200, creatives: 1000, minInterval: 60, autopilot: true },
];
const BLURB: Record<string, string> = {
  free: "For trying Looi on one product.",
  pro: "For founders who want a full-time growth agent.",
  scale: "For agencies and studios running many products.",
};
const hours = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);
function features(p: PlanInfo) {
  return [
    `${p.missions} active mission${p.missions > 1 ? "s" : ""}`,
    `${p.audits} deep site audits / month`,
    `${p.creatives.toLocaleString("en-IN")} video ads / month`,
    `Re-checks every ${hours(p.minInterval)}`,
    p.autopilot ? "Autopilot publishing" : "Publish with approval",
    "Looi AI included, no API keys",
    ...(p.key === "scale" ? ["Priority in the render queue"] : p.key === "pro" ? ["Faster queue than Free"] : []),
  ];
}

export function PricingCards({
  plans,
  current,
  trialDays = 7,
  onChoose,
  busy,
}: {
  plans?: PlanInfo[];
  current?: string;
  trialDays?: number;
  onChoose: (plan: PlanInfo) => void;
  busy?: string;
}) {
  const list = plans?.length ? plans : DEFAULT_PLANS;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {list.map((p) => {
        const hot = p.key === "pro";
        const isCurrent = current === p.key;
        return (
          <div key={p.key} className={cn("relative flex flex-col rounded-2xl border bg-card p-6", hot ? "border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/.25),0_30px_80px_-30px_hsl(var(--primary)/.45)]" : "border-border")} data-testid={`plan-${p.key}`}>
            {hot && <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">Most popular</span>}
            <p className="font-display text-lg font-bold">{p.label}</p>
            <p className="mt-1 min-h-10 text-sm text-muted-foreground">{BLURB[p.key]}</p>
            <p className="mt-5 flex items-baseline gap-1">
              <span className="font-display text-4xl font-extrabold tracking-tight">{p.priceInr ? inr(p.priceInr) : "₹0"}</span>
              <span className="text-sm text-muted-foreground">/ month</span>
            </p>
            {p.key === "free" && <p className="mt-1 text-xs text-primary">Starts with a {trialDays}-day Pro trial</p>}
            {p.key !== "free" && <p className="mt-1 text-xs text-muted-foreground">Pay by UPI · any app · no auto-debit</p>}
            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              {features(p).map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button className="mt-6 w-full" variant={hot ? "default" : "secondary"} disabled={isCurrent || busy === p.key || (p.key === "free" && !!current && current !== "free")} onClick={() => onChoose(p)} data-testid={`button-plan-${p.key}`}>
              {isCurrent ? "Current plan" : busy === p.key ? "Opening checkout…" : p.key === "free" ? (current ? "Always available" : "Start free") : current === "scale" && p.key === "pro" ? "Switch to Pro" : `Get ${p.label}`}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
