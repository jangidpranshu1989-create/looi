export interface Settings {
  provider: string; // groq | nvidia | openai | custom
  baseUrl: string;
  apiKey: string;
  model: string;
  intervalMinutes: number;
  defaultMode: "approval" | "autopilot";
  psiKey: string;
  brandVoice: string;
  language: string;
  composioKey: string;
  aiVisuals: boolean;
  builtinFallback: boolean;
  publicBaseUrl: string;
  onboarded?: boolean;
  userId?: string;
}
export const DEFAULT_SETTINGS: Settings = {
  provider: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "",
  model: "",
  intervalMinutes: 150,
  defaultMode: "approval",
  psiKey: "",
  brandVoice: "",
  language: "English",
  composioKey: "",
  aiVisuals: false,
  builtinFallback: false,
  publicBaseUrl: "",
};
