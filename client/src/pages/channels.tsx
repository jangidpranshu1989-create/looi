import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2, RefreshCcw, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Empty } from "@/components/looi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function Channels() {
  const { toast } = useToast();
  const { data: meta } = useQuery<any>({ queryKey: ["/api/meta"] });
  const { data: channels = [] } = useQuery<any[]>({ queryKey: ["/api/channels"], staleTime: 0 });
  const [type, setType] = useState<string | null>(null);
  const inv = () => queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
  const test = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/channels/${id}/test`)).json(),
    onSuccess: (r) => { inv(); toast({ title: "Connected", description: r.who }); },
    onError: (e: Error) => { inv(); toast({ title: "Connection failed", description: e.message, variant: "destructive" }); },
  });
  const del = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/channels/${id}`), onSuccess: inv });
  const types = Object.entries<any>(meta?.channelTypes || {});
  return (
    <AppShell title="Channels">
      <h1 className="font-display text-xl font-bold">Channels</h1>
      <p className="mt-1 text-sm text-muted-foreground">Where Looi publishes. Credentials are stored on your Looi server and only used to post your ads.</p>

      <div className="mt-6 space-y-3">
        {channels.length === 0 && <Empty title="No channels connected" body="Pick a platform below. Ads are still produced and downloadable without channels." />}
        {channels.map((c) => (
          <div key={c.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center" data-testid={`card-channel-${c.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", c.status === "connected" ? "bg-ok" : c.status === "error" ? "bg-bad" : "bg-muted-foreground")} />
                <p className="truncate font-medium">{c.name}</p>
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{Object.entries(c.config).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
              {c.lastError && <p className="mt-1 break-words text-xs text-bad">{c.lastError}</p>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => test.mutate(c.id)} disabled={test.isPending} data-testid={`button-test-channel-${c.id}`}><RefreshCcw className="size-4" /> Test</Button>
              <Button size="icon" variant="ghost" onClick={() => del.mutate(c.id)} aria-label="Remove channel" data-testid={`button-delete-channel-${c.id}`}><Trash2 className="size-4" /></Button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-sm font-semibold">Add a channel</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {types.map(([k, t]) => (
          <button key={k} onClick={() => setType(k)} className="flex flex-col items-start rounded-xl border border-border bg-card p-4 text-left hover-elevate" data-testid={`button-add-${k}`}>
            <div className="flex w-full items-center justify-between"><span className="font-medium">{t.label}</span><Plus className="size-4 text-muted-foreground" /></div>
            <span className="mt-1 text-xs text-muted-foreground">{t.media}</span>
          </button>
        ))}
      </div>
      <ConnectDialog type={type} def={type ? meta?.channelTypes?.[type] : null} onClose={() => setType(null)} />
    </AppShell>
  );
}

function ConnectDialog({ type, def, onClose }: { type: string | null; def: any; onClose: () => void }) {
  const { toast } = useToast();
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/channels", { type, config: vals })).json(),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      toast(c.status === "connected" ? { title: "Channel connected", description: c.name } : { title: "Saved, but verification failed", description: c.lastError, variant: "destructive" });
      setVals({});
      onClose();
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={!!type} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect {def?.label}</DialogTitle>
          <DialogDescription>{def?.note}</DialogDescription>
        </DialogHeader>
        <form id="connect" className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {def?.fields?.map((f: any) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input id={f.key} type={f.secret ? "password" : "text"} placeholder={f.placeholder} value={vals[f.key] || ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} required autoComplete="off" data-testid={`input-channel-${f.key}`} />
            </div>
          ))}
          {def?.docs && <a href={def.docs} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">How to get these <ExternalLink className="size-3" /></a>}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="connect" disabled={save.isPending} data-testid="button-save-channel">{save.isPending ? "Verifying…" : "Connect"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
