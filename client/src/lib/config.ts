/** Public project links (override at build time with VITE_* env vars). */
export const GITHUB_URL = (import.meta as any).env?.VITE_GITHUB_URL || "https://github.com/jangidpranshu1989-create/looi";
export const SUPPORT_EMAIL = (import.meta as any).env?.VITE_SUPPORT_EMAIL || "jangid.pranshu1989@gmail.com";
/** WhatsApp / phone for enquiries, with country code, digits only. */
export const SUPPORT_WHATSAPP = (import.meta as any).env?.VITE_SUPPORT_WHATSAPP || "918529418454";
export const SUPPORT_PHONE_DISPLAY = "+91 85294 18454";
export const waLink = (text = "Hi Looi team, ") => `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
