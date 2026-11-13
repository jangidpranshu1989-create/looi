import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Dashboard, { NewMission } from "@/pages/dashboard";
import MissionPage from "@/pages/mission";
import Approvals from "@/pages/approvals";
import Channels from "@/pages/channels";
import Settings from "@/pages/settings";
import DownloadPage from "@/pages/download";
import AuthPage from "@/pages/auth";
import Billing from "@/pages/billing";
import AdminPage from "@/pages/admin";
import { LegalPage } from "@/pages/legal";
import { useMe } from "@/lib/auth";
import { isDeviceMode } from "@/lib/queryClient";
import { LooiMark } from "@/components/looi";

/** Looi Cloud: app pages need an account. Self-hosted / on-device: open. */
function Guard({ children }: { children: React.ReactNode }) {
  const device = isDeviceMode();
  const { data: me, isLoading } = useMe();
  if (device) return <>{children}</>;
  if (isLoading)
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <LooiMark className="size-8" spinning />
      </div>
    );
  if (me?.saas && !me.user) return <Redirect to="/login" />;
  return <>{children}</>;
}
const guard = (C: any) => (p: any) => (
  <Guard>
    <C {...p} />
  </Guard>
);
const GDashboard = guard(Dashboard);
const GNew = guard(NewMission);
const GMission = guard(MissionPage);
const GApprovals = guard(Approvals);
const GChannels = guard(Channels);
const GSettings = guard(Settings);
const GBilling = guard(Billing);
const GAdmin = guard(AdminPage);

function AppRouter() {
  const native = typeof window !== "undefined" && window.__LOOI__?.native;
  return (
    <Switch>
      <Route path="/" component={native ? GDashboard : Landing} />
      <Route path="/login">{() => <AuthPage mode="login" />}</Route>
      <Route path="/signup">{() => <AuthPage mode="signup" />}</Route>
      <Route path="/app" component={GDashboard} />
      <Route path="/app/new" component={GNew} />
      <Route path="/app/m/:id" component={GMission} />
      <Route path="/app/approvals" component={GApprovals} />
      <Route path="/app/channels" component={GChannels} />
      <Route path="/app/settings" component={GSettings} />
      <Route path="/app/billing" component={GBilling} />
      <Route path="/app/admin" component={GAdmin} />
      <Route path="/download" component={DownloadPage} />
      <Route path="/privacy">{() => <LegalPage kind="privacy" />}</Route>
      <Route path="/terms">{() => <LegalPage kind="terms" />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
