/** Tiny IndexedDB-backed table store with an in-memory cache (on-device mode). */
const TABLES = ["missions", "creatives", "channels", "posts", "events", "notifications", "approvals", "snapshots", "playbooks"] as const;
export type Table = (typeof TABLES)[number];
export type Row = { id: number; [k: string]: any };

const mem: Record<string, Row[]> = {};
const seq: Record<string, number> = {};
const kv: Record<string, any> = {};
let idb: IDBDatabase | null = null;
const timers: Record<string, any> = {};

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("looi-device", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      if (!d.objectStoreNames.contains("media")) d.createObjectStore("media");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export function store(name: "kv" | "media", mode: IDBTransactionMode = "readonly") {
  return idb!.transaction(name, mode).objectStore(name);
}
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

export async function initDb() {
  idb = await open();
  const keys = (await req(store("kv").getAllKeys())) as string[];
  const vals = await req(store("kv").getAll());
  keys.forEach((k, i) => (kv[k] = vals[i]));
  for (const t of TABLES) {
    mem[t] = Array.isArray(kv["t:" + t]) ? kv["t:" + t] : [];
    seq[t] = mem[t].reduce((a, r) => Math.max(a, r.id), 0);
  }
}

function persist(key: string, value: any, delay = 250) {
  kv[key] = value;
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    try {
      store("kv", "readwrite").put(value, key);
    } catch (e) {
      console.warn("persist failed", e);
    }
  }, delay);
}
export function flush() {
  for (const k of Object.keys(timers)) {
    clearTimeout(timers[k]);
    try {
      store("kv", "readwrite").put(kv[k], k);
    } catch {}
  }
}

const CAPS: Partial<Record<Table, number>> = { events: 2500, notifications: 100 };
const save = (t: Table) => {
  const cap = CAPS[t];
  if (cap && mem[t].length > cap) mem[t] = mem[t].slice(-cap);
  persist("t:" + t, mem[t]);
  try {
    dbHooks.onChange(t);
  } catch {}
};
export const dbHooks = { onChange: (_t: Table) => {} };

export const db = {
  all: (t: Table) => mem[t],
  get: (t: Table, id: number) => mem[t].find((r) => r.id === id),
  where: (t: Table, f: (r: Row) => boolean) => mem[t].filter(f),
  insert(t: Table, v: Record<string, any>): Row {
    const row = { ...v, id: ++seq[t] } as Row;
    mem[t].push(row);
    save(t);
    return row;
  },
  update(t: Table, id: number, patch: Record<string, any>): Row | undefined {
    const r = mem[t].find((x) => x.id === id);
    if (!r) return undefined;
    Object.assign(r, patch);
    save(t);
    return r;
  },
  remove(t: Table, f: (r: Row) => boolean) {
    mem[t] = mem[t].filter((r) => !f(r));
    save(t);
  },
  kvGet: (k: string) => kv[k],
  kvSet: (k: string, v: any) => persist(k, v, 50),
};
