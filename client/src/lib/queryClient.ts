import { QueryClient, QueryFunction } from "@tanstack/react-query";

const BUILT_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// Native shell (Capacitor) injects window.__LOOI__ = { server, device } before the app boots.
declare global {
  interface Window {
    __LOOI__?: { server?: string; device?: string; native?: boolean };
  }
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
  return h;
}
export const mediaUrl = (file?: string, download = false) => (file ? `${apiBase()}/api/media/${file}${download ? "?download=1" : ""}` : "");

async function throwIfResNotOk(res: Response) {
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
