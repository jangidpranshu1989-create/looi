import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getToken, setToken } from "./auth";

const BUILT_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// Native shell (Capacitor) injects window.__LOOI__ = { server, device } before the app boots.
declare global {
  interface Window {
    __LOOI__?: { server?: string; device?: string; native?: boolean; mode?: "device" | "server"; relay?: string; relayCaps?: { ai?: boolean; composio?: boolean } | null };
  }
}
/** On-device mode: the agent runs inside this app (phone) — no server. */
export function isDeviceMode() {
  if (typeof window === "undefined") return false;
  if (window.__LOOI__?.mode === "device") return true;
  try {
    return localStorage.getItem("looiMode") === "device";
  } catch {
    return false;
  }
}
let local: typeof import("@/local/router") | null = null;
let localMedia: typeof import("@/local/media") | null = null;
export async function initDeviceMode() {
  const [{ bootDevice }, r, m] = await Promise.all([import("@/local/bridge"), import("@/local/router"), import("@/local/media")]);
  await bootDevice();
  local = r;
  localMedia = m;
}
export function apiBase() {
  const s = typeof window !== "undefined" ? window.__LOOI__?.server : "";
  return (s || BUILT_BASE).replace(/\/$/, "");
}
function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const d = typeof window !== "undefined" ? window.__LOOI__?.device : "";
  if (d) h["X-Looi-Device"] = d;
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}
export const mediaUrl = (file?: string, download = false) => {
  if (!file) return "";
  if (localMedia) return download ? `looi-media:${file}` : localMedia.getMediaUrl(file);
  return `${apiBase()}/api/media/${file}${download ? "?download=1" : ""}`;
};

/** Signed-out on a Looi Cloud server → go to sign-in. */
function onUnauthorized(res: Response) {
  if (res.status !== 401 || local) return;
  setToken("");
  const h = typeof window !== "undefined" ? window.location.hash : "";
  if (/^#\/app/.test(h) || (window.__LOOI__?.native && !/#\/(login|signup)/.test(h))) window.location.hash = "#/login";
}
async function throwIfResNotOk(res: Response) {
  onUnauthorized(res);
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let msg = text;
    try {
      msg = JSON.parse(text).message || text;
    } catch {}
    throw new Error(msg);
  }
}

export async function apiRequest(method: string, url: string, data?: unknown | undefined): Promise<Response> {
  if (local) {
    const r = await local.localFetch(method, url, data);
    await throwIfResNotOk(r.clone());
    return r;
  }
  const res = await fetch(`${apiBase()}${url}`, {
    method,
    headers: headers(data !== undefined),
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    if (local) {
      const r = await local.localFetch("GET", queryKey.join("/"));
      await throwIfResNotOk(r.clone());
      return await r.json();
    }
    const res = await fetch(`${apiBase()}${queryKey.join("/")}`, { headers: headers(false) });
    if (unauthorizedBehavior === "returnNull" && res.status === 401) return null;
    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: { retry: false },
  },
});
