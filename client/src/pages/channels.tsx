import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Plus, RefreshCcw, Search, Trash2, Webhook, KeyRound, Pencil } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiBase, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Plugin = { slug: string; name: string; category?: string; blurb?: string; description?: string; logo: string; target?: { label: string; placeholder: string; required?: boolean } | null; needsPublicMedia?: boolean };

/** Open the Composio Connect Link. Uses the native in-app browser on Android/iOS. */
function openExternal(url: string, pre?: Window | null) {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.() && cap.Plugins?.Browser) return cap.Plugins.Browser.open({ url });
  if (pre && !pre.closed) {
    pre.location.href = url;
    return;
  }
  const w = window.open(url, "_blank", "noopener");
  if (!w) window.location.href = url;
}

function Logo({ src, name, className }: { src: string; name: string; className?: string }) {
  const [err, setErr] = useState(false);
  return (
    <div className={cn("grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/95 ring-1 ring-border", className)}>
      {err ? <span className="font-display text-sm font-bold text-black">{name.slice(0, 1)}</span> : <img src={src} alt="" className="size-6 object-contain" onError={() => setErr(true)} loading="lazy" />}
    </div>
  );
}

export default function Channels() {
  const { toast } = useToast();
  const { data: plug } = useQuery<any>({ queryKey: ["/api/plugins"] });
  const { data: channels = [] } = useQuery<any[]>({ queryKey: ["/api/channels"], staleTime: 0 });
  const [pick, setPick] = useState<Plugin | null>(null);
  const [hook, setHook] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const inv = () => queryClient.invalidateQueries({ queryKey: ["/api/channels"] });

  // Poll pending connections until the user finishes the OAuth tab.
  const pending = channels.filter((c) => c.type === "composio" && c.status === "pending");
  useEffect(() => {
    if (!pending.length) return;
    let alive = true;
    const tick = async () => {
      for (const c of pending) {
        try {
          const r = await (await apiRequest("POST", `/api/plugins/${c.id}/refresh`)).json();
          if (r.status === "connected" && alive) toast({ title: `${r.name} connected`, description: "Looi will publish your next ads here." });
        } catch {}
      }
      if (alive) inv();
    };
    const t = setInterval(tick, 3500);
    window.addEventListener("focus", tick);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", tick);
    };
  }, [pending.map((c) => c.id).join(",")]);

  const search = useQuery<Plugin[]>({ queryKey: ["/api/plugins/search?q=" + encodeURIComponent(dq)], enabled: !!plug?.configured && dq.length > 1 });
  const test = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/channels/${id}/test`)).json(),
    onSuccess: (r) => { inv(); toast({ title: "Connected", description: r.who }); },
    onError: (e: Error) => { inv(); toast({ title: "Not connected", description: e.message, variant: "destructive" }); },
  });
  const del = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/channels/${id}`), onSuccess: inv });

  const connectedBySlug = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const c of channels) if (c.type === "composio") (m[c.config.toolkit] ||= []).push(c);
    return m;
  }, [channels]);
  const catalog: Plugin[] = plug?.catalog || [];
  const cats = Array.from(new Set(catalog.map((p) => p.category)));

  return (
    <AppShell title="Plugins">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-bold">Plugins</h1>
        <p className="text-sm text-muted-foreground">Connect your accounts in one click. Sign-in happens on the platform itself through Composio. Looi never sees your password or tokens.</p>
      </div>

      {plug && !plug.configured && <SetupComposio />}

      {channels.length > 0 && (
        <div className="mt-6 space-y-2">
          <h2 className="text-sm font-semibold">Connected</h2>
          {channels.map((c) => (
            <div key={c.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center" data-testid={`card-channel-${c.id}`}>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {c.type === "composio" ? <Logo src={c.config.logo} name={c.name} className="size-9" /> : <div className="grid size-9 place-items-center rounded-xl bg-muted"><Webhook className="size-4" /></div>}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{c.name}</p>
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", c.status === "connected" ? "bg-ok/15 text-ok" : c.status === "pending" ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad")}>
                      {c.status === "pending" && <Loader2 className="size-3 animate-spin" />}
                      {c.status === "connected" ? "Connected" : c.status === "pending" ? "Waiting for sign-in" : "Needs attention"}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{c.type === "composio" ? c.config.tool || c.config.toolkit : c.config.url}</p>
                  {c.lastError && <p className="mt-1 break-words text-xs text-bad">{c.lastError}</p>}
                </div>
              </div>
              <div className="flex gap-1.5">
                {c.type === "composio" && catalog.find((p) => p.slug === c.config.toolkit)?.target && (
                  <Button size="icon" variant="ghost" onClick={() => setEditing(c)} aria-label="Edit target" data-testid={`button-edit-channel-${c.id}`}><Pencil className="size-4" /></Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => test.mutate(c.id)} disabled={test.isPending} data-testid={`button-test-channel-${c.id}`}><RefreshCcw className="size-4" /> {c.status === "pending" ? "Check" : "Test"}</Button>
                <Button size="icon" variant="ghost" onClick={() => del.mutate(c.id)} aria-label="Disconnect" data-testid={`button-delete-channel-${c.id}`}><Trash2 className="size-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {cats.map((cat) => (
        <div key={cat} className="mt-8">
          <h2 className="text-sm font-semibold">{cat}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.filter((p) => p.category === cat).map((p) => (
              <PluginCard key={p.slug} p={p} count={connectedBySlug[p.slug]?.filter((c) => c.status === "connected").length || 0} disabled={!plug?.configured} onConnect={() => (p.target ? setPick(p) : startConnect(p, "", toast))} />
            ))}
          </div>
        </div>
      ))}

      <div className="mt-8">
        <h2 className="text-sm font-semibold">More apps</h2>
        <p className="mt-1 text-xs text-muted-foreground">Search 1,000+ apps on Composio. For apps outside the list above, Looi's agent picks the right publishing action after you connect.</p>
        <div className="relative mt-3 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={plug?.configured ? "Search apps: Mastodon, Bluesky, Medium, HubSpot…" : "Add your Composio key to search apps"} disabled={!plug?.configured} className="pl-9" data-testid="input-plugin-search" />
        </div>
        {search.isFetching && <p className="mt-3 text-xs text-muted-foreground">Searching…</p>}
        {search.error && <p className="mt-3 text-xs text-bad">{(search.error as Error).message}</p>}
        {!!search.data?.length && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {search.data.filter((p) => !catalog.some((c) => c.slug === p.slug)).map((p) => (
              <PluginCard key={p.slug} p={{ ...p, blurb: p.description }} count={connectedBySlug[p.slug]?.filter((c) => c.status === "connected").length || 0} disabled={false} onConnect={() => startConnect(p, "", toast)} />
            ))}
          </div>
        )}
        <button onClick={() => setHook(true)} className="mt-6 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" data-testid="button-add-webhook">
          <Webhook className="size-3.5" /> Advanced: send to a Zapier / Make / n8n webhook
        </button>
      </div>

      <ConnectDialog plugin={pick} onClose={() => setPick(null)} />
      <TargetDialog channel={editing} plugin={editing ? catalog.find((p) => p.slug === editing.config.toolkit) : null} onClose={() => setEditing(null)} />
      <WebhookDialog open={hook} onClose={() => setHook(false)} />
    </AppShell>
  );
}

function PluginCard({ p, count, disabled, onConnect }: { p: Plugin; count: number; disabled: boolean; onConnect: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4" data-testid={`card-plugin-${p.slug}`}>
      <Logo src={p.logo} name={p.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{p.name}</p>
          {count > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-ok"><Check className="size-3" />{count > 1 ? count : ""}</span>}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.blurb}</p>
      </div>
      <Button size="sm" variant={count ? "secondary" : "default"} onClick={onConnect} disabled={disabled} data-testid={`button-connect-${p.slug}`}>
        {count ? <Plus className="size-4" /> : "Connect"}
      </Button>
    </div>
  );
}

async function startConnect(plugin: Plugin, target: string, toast: ReturnType<typeof useToast>["toast"], done?: () => void) {
  const cap = (window as any).Capacitor?.isNativePlatform?.();
  const pre = cap ? null : window.open("about:blank", "_blank");
  try {
    const callbackUrl = new URL(`${apiBase()}/api/plugins/callback`, location.href).toString();
    const r = await (await apiRequest("POST", "/api/plugins/connect", { toolkit: plugin.slug, target, name: plugin.name, logo: plugin.logo, callbackUrl })).json();
    queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
    openExternal(r.redirectUrl, pre);
    toast({ title: `Finish signing in to ${plugin.name}`, description: "We opened the secure sign-in page. Looi detects the connection automatically." });
    done?.();
  } catch (e) {
    pre?.close();
    toast({ title: "Couldn't start connection", description: (e as Error).message, variant: "destructive" });
  }
}

function ConnectDialog({ plugin, onClose }: { plugin: Plugin | null; onClose: () => void }) {
  const { toast } = useToast();
  const [target, setTarget] = useState("");
  useEffect(() => setTarget(""), [plugin?.slug]);
  const go = () => plugin && startConnect(plugin, target, toast, onClose);
  const needsTarget = !!plugin?.target;
  return (
    <Dialog open={!!plugin && needsTarget} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {plugin && <Logo src={plugin.logo} name={plugin.name} />}
            <div>
              <DialogTitle>Connect {plugin?.name}</DialogTitle>
              <DialogDescription>Where should Looi post?</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form id="plug" className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void go(); }}>
          <Label htmlFor="target">{plugin?.target?.label}</Label>
          <Input id="target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={plugin?.target?.placeholder} required={!!plugin?.target?.required} autoFocus data-testid="input-plugin-target" />
          {plugin?.needsPublicMedia && <p className="pt-1 text-xs text-muted-foreground">Needs your Looi public URL (Settings) so the platform can fetch the poster.</p>}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="plug" data-testid="button-plugin-continue">Continue to sign in <ExternalLink className="size-4" /></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TargetDialog({ channel, plugin, onClose }: { channel: any; plugin?: Plugin | null; onClose: () => void }) {
  const [v, setV] = useState("");
  useEffect(() => setV(channel?.config?.target || ""), [channel?.id]);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/channels/${channel.id}`, { target: v })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/channels"] }); onClose(); },
  });
  return (
    <Dialog open={!!channel} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{plugin?.target?.label}</DialogTitle><DialogDescription>{channel?.name}</DialogDescription></DialogHeader>
        <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={plugin?.target?.placeholder} data-testid="input-edit-target" />
        <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-target">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetupComposio() {
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      await (await apiRequest("POST", "/api/plugins/verify", { key })).json();
      return (await apiRequest("PATCH", "/api/settings", { composioKey: key })).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Plugins enabled", description: "One-click connect is ready." });
    },
    onError: (e: Error) => toast({ title: "Key didn't work", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4" data-testid="card-setup-composio">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><KeyRound className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Turn on one-click plugins</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Looi uses Composio for secure OAuth with 1,000+ apps. Paste a project API key once. Server owners can set <span className="font-mono">COMPOSIO_API_KEY</span> instead, so every user connects with one click and no setup.{" "}
            <a href="https://platform.composio.dev" target="_blank" rel="noopener noreferrer" className="text-primary">Get a free key</a>
          </p>
          <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Composio API key" autoComplete="off" required className="sm:max-w-sm" data-testid="input-composio-key" />
            <Button type="submit" disabled={save.isPending || !key} data-testid="button-save-composio">{save.isPending ? "Checking…" : "Enable plugins"}</Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function WebhookDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/channels", { type: "webhook", config: { url } })).json(),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      toast(c.status === "connected" ? { title: "Webhook connected", description: c.name } : { title: "Saved, but test failed", description: c.lastError, variant: "destructive" });
      setUrl("");
      onClose();
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Webhook</DialogTitle><DialogDescription>Looi POSTs JSON with caption, link and media URLs. Route it anywhere with Zapier, Make or n8n.</DialogDescription></DialogHeader>
        <form id="hook" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/…" required data-testid="input-webhook-url" />
        </form>
        <DialogFooter><Button type="submit" form="hook" disabled={save.isPending} data-testid="button-save-webhook">{save.isPending ? "Testing…" : "Connect"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
