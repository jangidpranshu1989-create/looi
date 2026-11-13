import { store } from "./db";

const urls = new Map<string, string>();
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

export async function initMedia() {
  const keys = (await req(store("media").getAllKeys())) as string[];
  for (const k of keys) {
    const b = (await req(store("media").get(k))) as Blob;
    if (b) urls.set(k, URL.createObjectURL(b));
  }
}
export async function putMedia(name: string, blob: Blob) {
  await req(store("media", "readwrite").put(blob, name));
  const old = urls.get(name);
  if (old) URL.revokeObjectURL(old);
  urls.set(name, URL.createObjectURL(blob));
  return name;
}
export const getMediaUrl = (name?: string) => (name ? urls.get(name) || "" : "");
export async function getMedia(name: string): Promise<Blob | null> {
  if (!name) return null;
  return ((await req(store("media").get(name))) as Blob) || null;
}
export async function deleteMedia(names: string[]) {
  for (const n of names.filter(Boolean)) {
    try {
      await req(store("media", "readwrite").delete(n));
    } catch {}
    const u = urls.get(n);
    if (u) URL.revokeObjectURL(u);
    urls.delete(n);
  }
}
export async function blobToB64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
export const nameFromUrl = (u: string) => [...urls.entries()].find(([, v]) => v === u)?.[0] || "";
