import { fetchHttp, withTimeout, type HttpFn } from "./core/http";

const cap = () => (window as any).Capacitor;
export const isNative = () => !!cap()?.isNativePlatform?.();

/** Native: CapacitorHttp (no CORS, real headers). Web/QA: fetch. */
export const http: HttpFn = async (url, o = {}) => {
  const CH = cap()?.Plugins?.CapacitorHttp;
  if (!isNative() || !CH) return fetchHttp(url, o);
  const t0 = Date.now();
  const headers = o.headers || {};
  let data: any = o.body;
  if (data !== undefined && /json/i.test(headers["Content-Type"] || headers["content-type"] || "")) {
    try {
      data = JSON.parse(data);
    } catch {}
  }
  const r: any = await withTimeout(
    CH.request({ url, method: o.method || "GET", headers, data, responseType: "text", connectTimeout: 20000, readTimeout: o.timeout || 60000 }),
    (o.timeout || 60000) + 5000,
    "HTTP",
  );
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers || {})) h[k.toLowerCase()] = String(v);
  const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data ?? "");
  return { status: r.status, ok: r.status >= 200 && r.status < 300, url: r.url || url, headers: h, text, ms: Date.now() - t0 };
};

/** Binary fetch → Blob (images for audit / ads). */
export async function fetchBlob(url: string, timeout = 30000): Promise<Blob | null> {
  try {
    if (url.startsWith("data:")) return await (await fetch(url)).blob();
    const CH = cap()?.Plugins?.CapacitorHttp;
    if (isNative() && CH) {
      const r: any = await withTimeout(CH.request({ url, method: "GET", responseType: "blob", readTimeout: timeout }), timeout + 5000);
      if (r.status >= 400) return null;
      const ct = String(Object.entries(r.headers || {}).find(([k]) => k.toLowerCase() === "content-type")?.[1] || "image/jpeg");
      const bin = atob(String(r.data || ""));
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: ct.split(";")[0] });
    }
    const r = await withTimeout(fetch(url), timeout);
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}
