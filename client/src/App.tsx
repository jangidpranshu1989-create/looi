import { Switch, Route, Router } from "wouter";
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

function AppRouter() {
  const native = typeof window !== "undefined" && window.__LOOI__?.native;
  return (
    <Switch>
      <Route path="/" component={native ? Dashboard : Landing} />
      <Route path="/app" component={Dashboard} />
      <Route path="/app/new" component={NewMission} />
      <Route path="/app/m/:id" component={MissionPage} />
      <Route path="/app/approvals" component={Approvals} />
      <Route path="/app/channels" component={Channels} />
      <Route path="/app/settings" component={Settings} />
      <Route path="/download" component={DownloadPage} />
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
