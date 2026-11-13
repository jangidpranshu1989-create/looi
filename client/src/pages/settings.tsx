import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ENGINES = [
  { id: "builtin", label: "Looi built-in", d: "No key needed" },
  { id: "groq", label: "Groq", d: "OpenAI-compatible" },
  { id: "nvidia", label: "NVIDIA NIM", d: "OpenAI-compatible" },
  { id: "openai", label: "OpenAI", d: "api.openai.com" },
  { id: "custom", label: "Custom", d: "Any base URL" },
];

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-border py-8 md:grid-cols-[260px_1fr]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {desc && <p className="mt-1 text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const { data: s, isLoading } = useQuery<any>({ queryKey: ["/api/settings"] });
  const { data: meta } = useQuery<any>({ queryKey: ["/api/meta"] });
  const [f, setF] = useState<any>(null);
  const [key, setKey] = useState("");
  const [psi, setPsi] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [testRes, setTestRes] = useState<any>(null);
  useEffect(() => { if (s && !f) setF(s); }, [s]);

  const save = useMutation({
    mutationFn: async (extra?: any) => (await apiRequest("PATCH", "/api/settings", { ...f, apiKey: key, psiKey: psi, ...extra })).json(),
    onSuccess: (n) => { queryClient.setQueryData(["/api/settings"], n); setF(n); setKey(""); setPsi(""); toast({ title: "Settings saved" }); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/settings", { ...f, apiKey: key, psiKey: psi });
      return (await apiRequest("POST", "/api/settings/test")).json();
    },
    onSuccess: (r) => { setTestRes(r); setKey(""); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: (e: Error) => setTestRes({ ok: false, message: e.message }),
  });
  const loadModels = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/settings", { ...f, apiKey: key });
      return (await apiRequest("GET", "/api/settings/models")).json();
    },
    onSuccess: (list) => { setModels(list); setKey(""); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: (e: Error) => toast({ title: "Couldn't list models", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !f) return <AppShell title="Settings"><Skeleton className="h-96 rounded-xl" /></AppShell>;
  const prov = meta?.providers?.[f.provider];
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  return (
    <AppShell title="Settings" actions={<Button size="sm" onClick={() => save.mutate(undefined)} disabled={save.isPending} data-testid="button-save-settings">{save.isPending ? "Saving…" : "Save"}</Button>}>
      <h1 className="font-display text-xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Configure the agent's brain, rhythm and how it publishes.</p>

      <Section title="AI engine" desc="Looi uses this model for audits, copy and strategy. Any OpenAI-compatible endpoint works.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {ENGINES.map((e) => (
            <button key={e.id} onClick={() => { setF({ ...f, provider: e.id, baseUrl: meta?.providers?.[e.id]?.baseUrl || (e.id === "custom" ? f.baseUrl : ""), model: meta?.providers?.[e.id]?.defaultModel || "" }); setModels([]); setTestRes(null); }} className={cn("rounded-lg border p-3 text-left hover-elevate", f.provider === e.id ? "border-primary bg-primary/5" : "border-border")} data-testid={`button-engine-${e.id}`}>
              <p className="text-sm font-medium">{e.label}</p>
              <p className="text-[11px] text-muted-foreground">{e.d}</p>
            </button>
          ))}
        </div>
        {f.provider !== "builtin" && (
          <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div className="space-y-1.5">
              <Label htmlFor="base">Base URL</Label>
              <Input id="base" value={f.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="https://your-endpoint/v1" className="font-mono text-sm" disabled={f.provider !== "custom"} data-testid="input-base-url" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key" className="flex items-center justify-between">API key {prov?.keyUrl && <a href={prov.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-normal text-primary">Get a key <ExternalLink className="size-3" /></a>}</Label>
              <Input id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.hasApiKey ? `Saved ${s.apiKeyHint} — type to replace` : "Paste your key"} autoComplete="off" data-testid="input-api-key" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Model</Label>
              <div className="flex gap-2">
                {models.length ? (
                  <Select value={f.model} onValueChange={(v) => set("model", v)}>
                    <SelectTrigger className="font-mono text-sm" data-testid="select-model"><SelectValue placeholder="Pick a model" /></SelectTrigger>
                    <SelectContent className="max-h-72">{models.map((m) => <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input id="model" value={f.model} onChange={(e) => set("model", e.target.value)} placeholder={prov?.defaultModel || "model-id"} className="font-mono text-sm" data-testid="input-model" />
                )}
                <Button variant="secondary" onClick={() => loadModels.mutate()} disabled={loadModels.isPending} data-testid="button-list-models">{loadModels.isPending ? <Loader2 className="size-4 animate-spin" /> : "Browse"}</Button>
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Fall back to Looi built-in if my provider fails<span className="block text-xs text-muted-foreground">Keeps the 24/7 loop alive during rate limits or outages.</span></span>
              <Switch checked={f.builtinFallback} onCheckedChange={(v) => set("builtinFallback", v)} data-testid="switch-fallback" />
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending} data-testid="button-test-engine">{test.isPending ? <><Loader2 className="size-4 animate-spin" /> Testing…</> : "Test connection"}</Button>
          {testRes && (testRes.ok ? <span className="inline-flex items-center gap-1.5 text-sm text-ok" data-testid="text-test-result"><CheckCircle2 className="size-4" /> Working via {testRes.via} · {testRes.ms} ms</span> : <span className="inline-flex items-center gap-1.5 text-sm text-bad" data-testid="text-test-result"><XCircle className="size-4" /> {testRes.message}</span>)}
        </div>
      </Section>

      <Section title="Agent rhythm" desc="How often Looi re-checks each mission, re-measures the site and decides the next move.">
        <div>
          <div className="flex items-center justify-between text-sm"><span>Re-check interval</span><span className="font-mono text-primary">{Math.floor(f.intervalMinutes / 60)}h {f.intervalMinutes % 60 ? `${f.intervalMinutes % 60}m` : ""}</span></div>
          <Slider className="mt-3" min={60} max={360} step={15} value={[f.intervalMinutes]} onValueChange={([v]) => set("intervalMinutes", v)} data-testid="slider-interval" />
          <p className="mt-2 text-xs text-muted-foreground">Recommended: 2–3 hours. Shorter intervals give fewer real signals per cycle.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[["approval", "Ask me first", "Each batch waits for your approval."], ["autopilot", "Autopilot", "Publish automatically for new missions."]].map(([v, t, d]) => (
            <button key={v} onClick={() => set("defaultMode", v)} className={cn("rounded-lg border p-3 text-left hover-elevate", f.defaultMode === v ? "border-primary bg-primary/5" : "border-border")} data-testid={`button-default-${v}`}>
              <p className="text-sm font-medium">{t}</p><p className="text-xs text-muted-foreground">{d}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Creative" desc="Voice and language for every ad, caption and playbook.">
        <div className="space-y-1.5">
          <Label htmlFor="lang">Language</Label>
          <Select value={f.language} onValueChange={(v) => set("language", v)}>
            <SelectTrigger id="lang" data-testid="select-language"><SelectValue /></SelectTrigger>
            <SelectContent>{["English", "Hinglish", "Hindi", "Spanish", "Portuguese", "French", "German", "Arabic", "Indonesian", "Japanese"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="voice">Brand voice</Label>
          <Textarea id="voice" value={f.brandVoice} onChange={(e) => set("brandVoice", e.target.value)} placeholder="e.g. Confident, witty, developer-friendly. Never use clichés like 'revolutionize'." data-testid="input-brand-voice" />
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>AI key visuals<span className="block text-xs text-muted-foreground">Generate a cinematic background image per mission for the spotlight template.</span></span>
          <Switch checked={f.aiVisuals} onCheckedChange={(v) => set("aiVisuals", v)} data-testid="switch-ai-visuals" />
        </label>
      </Section>

      <Section title="Tracking & data" desc="Public URL enables tracked links (looi.link/r/…) and lets Instagram fetch your video.">
        <div className="space-y-1.5">
          <Label htmlFor="pub">Public server URL</Label>
          <Input id="pub" value={f.publicBaseUrl} onChange={(e) => set("publicBaseUrl", e.target.value)} placeholder="https://looi.yourdomain.com" className="font-mono text-sm" data-testid="input-public-url" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="psi">PageSpeed Insights API key (optional)</Label>
          <Input id="psi" type="password" value={psi} onChange={(e) => setPsi(e.target.value)} placeholder={s.hasPsiKey ? "Saved — type to replace" : "Used only if local Lighthouse fails"} autoComplete="off" data-testid="input-psi-key" />
        </div>
      </Section>
      <div className="flex justify-end pt-6"><Button onClick={() => save.mutate(undefined)} disabled={save.isPending} data-testid="button-save-settings-bottom">Save settings</Button></div>
    </AppShell>
  );
}
