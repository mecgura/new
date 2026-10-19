import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Bot, Check, Inbox, Megaphone, Network, ShieldCheck, Wallet, Workflow } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { siteConfig } from "@/config/site";
import { formatINR, formatNumber } from "@/lib/catalog";
import { FEATURES, isUnlimited, parseFeatures } from "@/lib/plans";
import { Logo } from "@/components/layout/logo";
import { buttonVariants } from "@/components/ds";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "MECGURA: WhatsApp inbox, campaigns and AI for your business" },
  description: siteConfig.description,
  robots: { index: true, follow: true },
};

const FEATURE_CARDS = [
  { icon: Inbox, title: "Shared team inbox", text: "Every customer chat in one place. Assign, tag, add private notes, and reply inside the 24-hour window." },
  { icon: Megaphone, title: "Campaigns with a safety check", text: "Approved templates, opted-in contacts only. A compliance review runs before every send." },
  { icon: Workflow, title: "Automations and Flows", text: "Welcome messages, lead capture, appointment reminders and WhatsApp Flows without writing code." },
  { icon: Bot, title: "AI agent with human handoff", text: "Answers common questions and hands over to your team when a person is needed." },
  { icon: Network, title: "API and webhooks", text: "Connect your website, CRM or tools. Signed webhooks and API keys per workspace." },
  { icon: BarChart3, title: "Analytics", text: "Messages, delivery, replies and campaign results. See what works." },
  { icon: Wallet, title: "Prepaid wallet", text: "Clear per-message fees and a ledger of every credit and deduction." },
  { icon: ShieldCheck, title: "Built for separation", text: "Each client has their own private workspace, numbers and data." },
];

const CHANNELS = [
  { name: "WhatsApp Business", state: "Live", note: "Official Cloud API" },
  { name: "Email", state: "Coming soon", note: "Shared inbox for email threads" },
  { name: "Instagram and Messenger", state: "Coming soon", note: "DMs in the same inbox" },
  { name: "AI calling", state: "Planned", note: "Voice follow-ups for leads" },
];

const STEPS = [
  { n: "1", title: "We set up your workspace", text: "MECGURA creates your account, connects your WhatsApp Business number and gets your templates approved." },
  { n: "2", title: "Import contacts with consent", text: "Bring your customer list with their opt-in status. Opt-outs are respected automatically." },
  { n: "3", title: "Run campaigns and chats", text: "Your team replies from one inbox while campaigns and automations run in the background." },
];

const FAQ = [
  { q: "Who pays Meta's WhatsApp charges?", a: "Meta bills its own message charges to the payment method on your WhatsApp Business account. MECGURA's wallet and plan are separate, for the platform and service." },
  { q: "Can I sign up myself?", a: "Accounts are created by MECGURA so your number, templates and consent process are set up correctly. Get in touch and we will set you up." },
  { q: "Do I need a new phone number?", a: "You need a number that is not registered on the regular WhatsApp or WhatsApp Business app. We will guide you." },
  { q: "Where is my data?", a: "In your private workspace. See our Privacy Policy for what is stored and how to request deletion." },
];

async function loadPlans() {
  try {
    return await db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  } catch {
    return [];
  }
}

function contactHref() {
  const { whatsapp, email } = siteConfig.contact;
  if (whatsapp) return `https://wa.me/${whatsapp}?text=${encodeURIComponent("Hi MECGURA, I would like a demo of the WhatsApp platform.")}`;
  if (email) return `mailto:${email}?subject=${encodeURIComponent("MECGURA platform demo")}`;
  return "";
}

export default async function Landing() {
  const [plans, session] = await Promise.all([loadPlans(), auth().catch(() => null)]);
  const signedIn = Boolean(session?.user);
  const href = contactHref();
  return (
    <div className="app-root dark min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-2">
          <a href="#pricing" className="hidden px-3 py-2 text-small text-app-muted hover:text-app-text sm:inline">
            Pricing
          </a>
          <Link href={signedIn ? "/dashboard" : "/login"} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            {signedIn ? "Open workspace" : "Sign in"}
          </Link>
        </nav>
      </header>

      <main id="main-content">
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 text-center sm:pt-16">
          <p className="mb-4 inline-block rounded-full border border-app-border px-3 py-1 text-small text-app-muted">WhatsApp platform for Indian businesses</p>
          <h1 className="mx-auto max-w-3xl font-display text-4xl font-bold leading-tight sm:text-5xl">Talk to every customer on WhatsApp, from one inbox your whole team can use.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-app-muted">Shared inbox, consent-safe campaigns, automations and an AI agent on the official WhatsApp Business API, set up and supported by MECGURA.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {href ? (
              <a href={href} className={buttonVariants({ size: "lg" })}>
                Book a demo
              </a>
            ) : null}
            <Link href={signedIn ? "/dashboard" : "/login"} className={buttonVariants({ variant: href ? "secondary" : "primary", size: "lg" })}>
              {signedIn ? "Open workspace" : "Client sign in"}
            </Link>
          </div>
        </section>

        <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 py-12">
          <h2 id="features" className="mb-8 text-center font-display text-3xl font-bold">
            Everything your team needs
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURE_CARDS.map((f) => (
              <div key={f.title} className="rounded-2xl border border-app-border bg-app-elevated p-5">
                <span className="mb-3 grid size-10 place-items-center rounded-xl bg-app-primary/10 text-app-primary">
                  <f.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-small text-app-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="how" className="mx-auto max-w-6xl px-4 py-12">
          <h2 id="how" className="mb-8 text-center font-display text-3xl font-bold">
            How it works
          </h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-2xl border border-app-border p-5">
                <span className="mb-3 grid size-8 place-items-center rounded-full bg-app-primary text-app-on-primary font-bold">{s.n}</span>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-small text-app-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="channels" className="mx-auto max-w-6xl px-4 py-12">
          <h2 id="channels" className="mb-2 text-center font-display text-3xl font-bold">
            One inbox, more channels
          </h2>
          <p className="mb-8 text-center text-app-muted">WhatsApp is live today. The rest are on the roadmap and labelled honestly.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CHANNELS.map((c) => (
              <div key={c.name} className="rounded-2xl border border-app-border p-5">
                <p className="font-semibold">{c.name}</p>
                <p className="mt-1 text-small text-app-muted">{c.note}</p>
                <span className={`mt-3 inline-block rounded-full px-2.5 py-0.5 text-caption font-medium ${c.state === "Live" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-app-muted"}`}>{c.state}</span>
              </div>
            ))}
          </div>
        </section>

        {plans.length ? (
          <section id="pricing" aria-labelledby="pricing-title" className="mx-auto max-w-6xl px-4 py-12">
            <h2 id="pricing-title" className="mb-2 text-center font-display text-3xl font-bold">
              Plans
            </h2>
            <p className="mb-8 text-center text-app-muted">Platform plans in rupees. Meta&apos;s WhatsApp charges are billed by Meta separately.</p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {plans.map((p) => (
                <div key={p.id} className="flex flex-col rounded-2xl border border-app-border bg-app-elevated p-5">
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="mt-2 font-display text-3xl font-bold">
                    {p.selfServe ? formatINR(p.priceMonthly) : "Custom"}
                    {p.selfServe ? <span className="text-small font-normal text-app-muted"> / month</span> : null}
                  </p>
                  <p className="mt-1 text-small text-app-muted">{p.description}</p>
                  <ul className="mt-4 space-y-1.5 text-small">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-app-primary" aria-hidden="true" />
                      {isUnlimited(p.maxUsers) ? "Unlimited" : p.maxUsers} team members
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-app-primary" aria-hidden="true" />
                      {isUnlimited(p.maxWhatsAppNumbers) ? "Unlimited" : p.maxWhatsAppNumbers} WhatsApp number{p.maxWhatsAppNumbers === 1 ? "" : "s"}
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-app-primary" aria-hidden="true" />
                      {isUnlimited(p.maxMonthlyMessages) ? "Unlimited" : formatNumber(p.maxMonthlyMessages)} messages / month
                    </li>
                    {parseFeatures(p.features).map((k) => (
                      <li key={k} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-app-primary" aria-hidden="true" />
                        {FEATURES[k]}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="faq" className="mx-auto max-w-3xl px-4 py-12">
          <h2 id="faq" className="mb-6 text-center font-display text-3xl font-bold">
            Questions
          </h2>
          <div className="space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="rounded-2xl border border-app-border p-4">
                <summary className="cursor-pointer font-semibold">{f.q}</summary>
                <p className="mt-2 text-small text-app-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-app-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-small text-app-muted">
          <p>© {new Date().getFullYear()} MECGURA</p>
          <nav aria-label="Legal" className="flex gap-5">
            <Link href="/privacy" className="hover:text-app-text">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-app-text">
              Terms
            </Link>
            <Link href="/data-deletion" className="hover:text-app-text">
              Data deletion
            </Link>
            <Link href="/login" className="hover:text-app-text">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
