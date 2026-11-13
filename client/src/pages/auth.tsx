import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, Lock, Mail, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark, LooiMark } from "@/components/looi";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { setToken, useMe } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** URL typed on the landing page before signing up — launched right after. */
let pendingUrl = "";
export function setPendingUrl(u: string) {
  pendingUrl = u;
  try {
    localStorage.setItem("looiPendingUrl", u);
  } catch {}
}
function takePendingUrl() {
  let u = pendingUrl;
  try {
    u = u || localStorage.getItem("looiPendingUrl") || "";
    localStorage.removeItem("looiPendingUrl");
  } catch {}
  pendingUrl = "";
  return u;
}

export default function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const [, nav] = useLocation();
  const { data: me } = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const signup = mode === "signup";

  const submit = useMutation({
    mutationFn: async () => (await apiRequest("POST", signup ? "/api/auth/signup" : "/api/auth/login", { email, password, name })).json(),
    onSuccess: async (r: any) => {
      setToken(r.token);
      queryClient.clear();
      const url = takePendingUrl();
      if (url) {
        try {
          const m = await (await apiRequest("POST", "/api/missions", { url })).json();
          return nav(`/app/m/${m.id}`);
        } catch {}
      }
      nav("/app");
    },
    onError: (e: Error) => setErr(e.message),
  });

  const trialDays = me?.trialDays ?? 7;
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-border lg:block">
        <div className="hero-glow pointer-events-none absolute inset-0" />
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link href="/" data-testid="link-home">
            <Wordmark />
          </Link>
          <div className="max-w-md">
            <LooiMark className="size-10" spinning />
            <h2 className="mt-6 font-display text-4xl font-extrabold leading-[1.05] tracking-tight">Your marketing team that never clocks out.</h2>
            <ul className="mt-8 space-y-3 text-sm">
              {["Real site audit: speed, SEO, UI/UX and fixes", "Animated video ads made from your live product", "One-click publishing to X, LinkedIn, Reddit and more", "Re-checks every few hours and changes tactics by itself"].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/15">
                    <Check className="size-3 text-primary" />
                  </span>
                  <span className="text-muted-foreground">{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">No credit card. No API keys. {trialDays}-day free trial of Pro.</p>
        </div>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
        <div className="mx-auto my-auto w-full max-w-sm py-10">
          <h1 className="font-display text-3xl font-extrabold tracking-tight" data-testid="text-auth-title">
            {signup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{signup ? `Start your ${trialDays}-day free trial. Takes 20 seconds.` : "Sign in to check on your missions."}</p>

          {me && !me.saas && (
            <p className="mt-6 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
              This Looi server runs without accounts. <Link href="/app" className="text-primary">Open the dashboard</Link>.
            </p>
          )}

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setErr("");
              submit.mutate();
            }}
          >
            {signup && (
              <Field id="name" label="Name" icon={User}>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" className="h-11 pl-9" data-testid="input-name" />
              </Field>
            )}
            <Field id="email" label="Email" icon={Mail}>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" inputMode="email" className="h-11 pl-9" data-testid="input-email" />
            </Field>
            <Field id="password" label="Password" icon={Lock}>
              <Input id="password" type="password" required minLength={signup ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={signup ? "At least 8 characters" : "Your password"} autoComplete={signup ? "new-password" : "current-password"} className="h-11 pl-9" data-testid="input-password" />
            </Field>
            {err && (
              <p className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad" role="alert" data-testid="text-auth-error">
                {err}
              </p>
            )}
            <Button type="submit" size="lg" className="h-11 w-full font-semibold" disabled={submit.isPending} data-testid="button-auth-submit">
              {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {signup ? "Start free trial" : "Sign in"}
              {!submit.isPending && <ArrowRight className="size-4" />}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {signup ? "Already have an account? " : "New to Looi? "}
            <Link href={signup ? "/login" : "/signup"} className="font-medium text-primary" data-testid="link-auth-switch">
              {signup ? "Sign in" : "Create a free account"}
            </Link>
          </p>
          {signup && <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">By creating an account you agree that Looi may analyse the URLs you submit and publish only to channels you connect.</p>}
        </div>
      </main>
    </div>
  );
}

function Field({ id, label, icon: Icon, children }: { id: string; label: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div className={cn("relative")}>
        <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        {children}
      </div>
    </div>
  );
}
