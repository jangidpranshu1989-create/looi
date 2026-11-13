import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, LayoutGrid, ShieldCheck, Plug, Settings2, Smartphone, Plus, BellRing } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LivePill } from "./live-pill";
import { Wordmark, useLive, timeAgo } from "./looi";
import { cn } from "@/lib/utils";
import { useState } from "react";

const NAV = [
  { href: "/app", label: "Missions", icon: LayoutGrid, match: (p: string) => p === "/app" || p.startsWith("/app/m/") },
  { href: "/app/approvals", label: "Approvals", icon: ShieldCheck, badge: true },
  { href: "/app/channels", label: "Channels", icon: Plug },
  { href: "/app/settings", label: "Settings", icon: Settings2 },
];

function NotificationCenter() {
  const { data: live } = useLive();
  const [open, setOpen] = useState(false);
  const { data: list = [] } = useQuery<any[]>({ queryKey: ["/api/notifications"], enabled: open, refetchInterval: open ? 5000 : false, staleTime: 0 });
  const read = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/read"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/live"] }),
  });
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const unread = live?.unread || 0;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && unread) read.mutate();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications" aria-label="Notifications">
          <Bell className="size-4" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold text-primary-foreground">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Updates</p>
          {perm === "default" && (
            <button className="inline-flex items-center gap-1 text-xs text-primary" onClick={() => Notification.requestPermission().then(setPerm)} data-testid="button-enable-push">
              <BellRing className="size-3" /> Enable alerts
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {list.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No updates yet. Looi will report here after every cycle.</p>}
          {list.map((n) => (
            <Link key={n.id} href={n.approvalId ? "/app/approvals" : n.missionId ? `/app/m/${n.missionId}` : "/app"} onClick={() => setOpen(false)}>
              <div className={cn("flex gap-3 border-b border-border/60 px-4 py-3 hover-elevate", !n.read && "bg-primary/[.04]")} data-testid={`notification-${n.id}`}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.kind === "error" ? "bg-bad" : n.kind === "warn" || n.kind === "approval" ? "bg-warn" : n.kind === "success" ? "bg-ok" : "bg-primary")} />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug">{n.title}</p>
                  <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{n.body}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">{timeAgo(n.ts)}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AppShell({ children, title, actions }: { children: React.ReactNode; title?: React.ReactNode; actions?: React.ReactNode }) {
  const [path] = useLocation();
  const { data: live } = useLive();
  const pending = live?.approvals?.length || 0;
  return (
    <div className="flex min-h-dvh bg-background">
      <LivePill />
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 md:flex">
        <Link href="/" className="px-2 py-1" data-testid="link-home">
          <Wordmark />
        </Link>
        <Link href="/app/new">
          <Button className="mt-6 w-full justify-start" data-testid="button-new-mission">
            <Plus className="size-4" /> New mission
          </Button>
        </Link>
        <nav className="mt-6 space-y-0.5">
          {NAV.map((n) => {
            const active = n.match ? n.match(path) : path === n.href;
            return (
              <Link key={n.href} href={n.href}>
                <span className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover-elevate", active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground")} data-testid={`nav-${n.label.toLowerCase()}`}>
                  <n.icon className="size-4" />
                  {n.label}
                  {n.badge && pending > 0 && <span className="ml-auto rounded-full bg-warn/20 px-1.5 font-mono text-[10px] text-warn">{pending}</span>}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3">
          <Link href="/download">
            <span className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover-elevate" data-testid="nav-download">
              <Smartphone className="size-4" /> Get the app
            </span>
          </Link>
          <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground">
              <span className={cn("size-1.5 rounded-full", live ? "bg-ok" : "bg-muted-foreground")} />
              Agent {live ? "online" : "connecting"}
            </div>
            <p className="mt-1">{live?.jobs?.length ? `${live.jobs.length} job running` : "Idle · watching your missions"}</p>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
          <Link href="/" className="md:hidden">
            <Wordmark />
          </Link>
          <div className="hidden min-w-0 flex-1 md:block">{title && <div className="truncate text-sm text-muted-foreground">{title}</div>}</div>
          <div className="ml-auto flex items-center gap-1">
            {actions}
            <NotificationCenter />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-12">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {[NAV[0], NAV[1], { href: "/app/new", label: "New", icon: Plus }, NAV[2], NAV[3]].map((n: any) => {
          const active = n.match ? n.match(path) : path === n.href;
          return (
            <Link key={n.href} href={n.href}>
              <span className={cn("relative flex flex-col items-center gap-1 py-2.5 text-[11px]", active ? "text-primary" : "text-muted-foreground")} data-testid={`tab-${n.label.toLowerCase()}`}>
                {n.label === "New" ? (
                  <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Plus className="size-4" />
                  </span>
                ) : (
                  <n.icon className="size-5" />
                )}
                {n.label !== "New" && n.label}
                {n.badge && pending > 0 && <span className="absolute right-[28%] top-1.5 size-2 rounded-full bg-warn" />}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
