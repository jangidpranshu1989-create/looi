/** Looi Free relay (Cloudflare Worker) helpers — used when the agent runs on the device. */
export const relayBase = () => (typeof window !== "undefined" && window.__LOOI__?.relay ? String(window.__LOOI__.relay).replace(/\/$/, "") : "");
export const relayDevice = () => (typeof window !== "undefined" ? window.__LOOI__?.device || localStorage.getItem("looiDevice") || "" : "");
export const isFreeRelay = () => !!relayBase() && window.__LOOI__?.mode === "device";

export async function relayJson<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(relayBase() + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-looi-device": relayDevice() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error?.message || `Request failed (${r.status})`);
  return j as T;
}

export interface RelayPlan { key: "free" | "pro" | "scale"; label: string; inr: number; ai: number; media: number }
export interface RelayBilling {
  vpa: string;
  payee: string;
  plans: RelayPlan[];
  current: RelayPlan & { plan: string; until?: number; status?: "provisional" | "active" };
  last: any;
  provisionalHours: number;
}
