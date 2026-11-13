import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  window.location.hash = "#/";
}

import { isDeviceMode, initDeviceMode } from "./lib/queryClient";

/** Looi Free web build (Cloudflare Workers free plan): the agent runs in this tab, the relay on the same origin does AI, plugins and public links. */
async function bootFreeWeb() {
  if (!(import.meta as any).env?.VITE_LOOI_FREE || window.__LOOI__) return;
  let device = localStorage.getItem("looiDevice");
  if (!device) {
    device = "w" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("looiDevice", device);
  }
  const relay = location.origin;
  let relayCaps: any = null;
  try {
    const r = await fetch(`${relay}/relay/status`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) relayCaps = await r.json();
  } catch {}
  (window as any).__LOOI__ = { mode: "device", device, relay, relayCaps };
}

(async () => {
  await bootFreeWeb();
  if (isDeviceMode()) {
    try {
      await initDeviceMode();
    } catch (e) {
      console.error("device engine failed to start", e);
    }
  }
  createRoot(document.getElementById("root")!).render(<App />);
})();
