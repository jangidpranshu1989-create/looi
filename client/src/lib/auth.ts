import { useQuery } from "@tanstack/react-query";

/** Session token for Looi Cloud accounts (kept in memory + localStorage when available). */
let mem = "";
const KEY = "looiToken";
export function getToken() {
  if (mem) return mem;
  try {
    mem = localStorage.getItem(KEY) || "";
  } catch {}
  return mem;
}
export function setToken(t: string) {
  mem = t;
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {}
  try {
    (window as any).__LOOI_TOKEN_SYNC__?.(t); // keep the native background checker signed in
  } catch {}
}

export interface PlanInfo {
  key: "trial" | "free" | "pro" | "scale" | "unlimited";
  label: string;
  priceInr: number;
  missions: number;
  audits: number;
  creatives: number;
  minInterval: number;
  autopilot: boolean;
}
export interface Me {
  saas: boolean;
  payments: boolean;
  upi?: { vpa: string; payee: string };
  support?: { email: string; whatsapp: string };
  trialDays: number;
  plans: PlanInfo[];
  user: null | {
    id: number;
    email: string;
    name: string;
    admin: boolean;
    plan: PlanInfo;
    usage: { audits: number; creatives: number; missions: number };
    periodStart: number;
    periodEnd: number;
    trialEndsAt: number;
    paidUntil: number;
    createdAt: number;
  };
}
export function useMe() {
  return useQuery<Me>({ queryKey: ["/api/me"], staleTime: 30_000 });
}
export const daysLeft = (ts: number) => Math.max(0, Math.ceil((ts - Date.now()) / 86_400_000));
export const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

export interface Payment {
  id: number;
  orderId: string;
  plan: "pro" | "scale";
  amount: number;
  amountInr: string;
  status: "created" | "submitted" | "paid" | "rejected";
  utr: string;
  createdAt: number;
  utrAt: number;
  paidAt: number;
  note: string;
  provisional: boolean;
  expiresAt: number;
  upiUrl: string;
  vpa: string;
  payee: string;
  email?: string;
}
