/** Transport-agnostic HTTP used by the on-device engine (app + background runner). */
export interface HttpReq {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}
export interface HttpRes {
  status: number;
  ok: boolean;
  url: string;
  headers: Record<string, string>;
  text: string;
  ms: number;
}
export type HttpFn = (url: string, o?: HttpReq) => Promise<HttpRes>;

export function withTimeout<T>(p: Promise<T>, ms: number, label = "Request"): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => (clearTimeout(t), res(v)),
      (e) => (clearTimeout(t), rej(e)),
    );
  });
}

/** Plain fetch transport (browser with CORS, or Capacitor background runner). */
export const fetchHttp: HttpFn = async (url, o = {}) => {
  const t0 = Date.now();
  const init: any = { method: o.method || "GET", headers: o.headers || {} };
  if (o.body !== undefined) init.body = o.body;
  const r: any = await withTimeout(fetch(url, init), o.timeout || 60000, "HTTP");
  const text = await r.text();
  const headers: Record<string, string> = {};
  try {
    r.headers?.forEach?.((v: string, k: string) => (headers[k.toLowerCase()] = v));
  } catch {}
  return { status: r.status, ok: r.status >= 200 && r.status < 300, url: r.url || url, headers, text, ms: Date.now() - t0 };
};

export const J = (s: any, d: any = {}) => {
  if (s && typeof s === "object") return s;
  try {
    return JSON.parse(s) ?? d;
  } catch {
    return d;
  }
};
