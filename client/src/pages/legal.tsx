import { Link } from "wouter";
import { Wordmark } from "@/components/looi";
import { SUPPORT_EMAIL, GITHUB_URL, SUPPORT_PHONE_DISPLAY } from "@/lib/config";

const PRIVACY: [string, string][] = [
  ["What we collect", "Your email address, name and a salted hash of your password. The URLs you submit, the screenshots, audit results and ads Looi creates for them. The social and app accounts you connect through Composio, and the posts Looi publishes for you. Basic request logs (time, IP address, user agent) to keep the service secure."],
  ["How we use it", "Only to run your missions: audit your site, write and render ads, publish to the channels you choose, measure results and notify you. We don't sell your data and we don't use it to train AI models."],
  ["Who processes it", "AI requests go to our model providers (such as Groq or NVIDIA NIM). Site speed tests use Google PageSpeed Insights. Publishing goes through Composio to the platforms you connect. Payments are made by UPI directly to Looi's UPI ID; we store only the plan, amount and the UPI reference number (UTR) you submit, to verify the payment."],
  ["Notifications", "The mobile app shows notifications for mission updates and approvals. You can switch them off in your phone's settings at any time."],
  ["Retention and deletion", "Your data stays until you delete it. Delete a mission to remove its ads and history, or delete your whole account from Billing → Delete account. Deletion is immediate and permanent."],
  ["Contact", `Questions, payment issues or data requests: ${SUPPORT_EMAIL} · WhatsApp ${SUPPORT_PHONE_DISPLAY}.`],
];
const TERMS: [string, string][] = [
  ["The service", "Looi is an AI marketing agent. It analyses websites you own or are allowed to promote, creates ads and publishes them to channels you connect."],
  ["Your responsibilities", "Only submit sites you have the right to market. Follow the rules of every platform you connect. You are responsible for content published from your accounts, including in Autopilot mode."],
  ["Plans and payments", "Free trials end automatically. Paid plans are prepaid for 30 days and don't auto-renew. Usage limits for each plan are shown on the Pricing and Billing pages. Fees are non-refundable except where required by law."],
  ["Fair use", "We may pause accounts that abuse the service, send spam, target sites they don't control, or try to break platform rules."],
  ["No guarantees", "Looi works hard to grow your product, but we can't guarantee traffic, sales or results. The service is provided as is."],
  ["Open source", `The Looi source code is licensed under AGPL-3.0 and available at ${GITHUB_URL}. These terms cover the hosted service.`],
];

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const items = kind === "privacy" ? PRIVACY : TERMS;
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-5">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-14">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">{kind === "privacy" ? "Privacy policy" : "Terms of service"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated 13 November 2026</p>
        <div className="mt-10 space-y-8">
          {items.map(([h, b]) => (
            <section key={h}>
              <h2 className="font-semibold">{h}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
