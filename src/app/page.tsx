import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { BarChart3, Bot, Camera, Check, Globe, Inbox, Mail, Megaphone, MessageCircle, MessagesSquare, Phone, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { siteConfig } from "@/config/site";
import { formatINR, formatNumber } from "@/lib/catalog";
import { FEATURES, isUnlimited, parseFeatures } from "@/lib/plans";
import { Logo } from "@/components/layout/logo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "MECGURA: WhatsApp inbox, campaigns and AI for your business" },
  description: siteConfig.description,
  robots: { index: true, follow: true },
};

const FEATURE_CARDS = [
  { icon: Inbox, tone: "clay-mint", title: "One shared inbox", text: "Every customer chat in one place. Assign, tag, add private notes and reply as a team." },
  { icon: Megaphone, tone: "clay-peach", title: "Safe campaigns", text: "Approved templates to opted-in contacts only, with a compliance check before every send." },
  { icon: Workflow, tone: "clay-lilac", title: "Automations", text: "Welcome messages, lead capture and reminders that run on their own, no code." },
  { icon: Bot, tone: "clay-sky", title: "AI agent", text: "Answers common questions and hands over to your team when a person is needed." },
  { icon: BarChart3, tone: "clay-butter", title: "Clear analytics", text: "Messages, replies and campaign results, so you see what works." },
  { icon: ShieldCheck, tone: "clay-mint", title: "Private by design", text: "Every client gets a separate workspace, numbers and data." },
];

const CHANNELS = [
  { icon: MessageCircle, tone: "clay-mint", name: "WhatsApp", state: "Live" },
  { icon: Mail, tone: "clay-peach", name: "Email", state: "Live" },
  { icon: Globe, tone: "clay-sky", name: "Website chat", state: "Live" },
  { icon: MessagesSquare, tone: "clay-lilac", name: "Messenger", state: "Live" },
  { icon: Camera, tone: "clay-butter", name: "Instagram", state: "Live" },
  { icon: Phone, tone: "clay-mint", name: "AI calling", state: "Practice mode" },
];

const STEPS = [
  { n: "1", tone: "clay-mint", title: "We set you up", text: "MECGURA creates your workspace, connects your WhatsApp number and gets templates approved." },
  { n: "2", tone: "clay-peach", title: "Bring your contacts", text: "Import your list with consent. Opt-outs are respected automatically." },
  { n: "3", tone: "clay-lilac", title: "Chat and campaign", text: "Your team replies from one inbox while campaigns and automations run in the background." },
];

const FAQ = [
  { q: "Who pays Meta's WhatsApp charges?", a: "Meta bills its own message charges to the payment method on your WhatsApp Business account. MECGURA's plan and wallet are separate, for the platform and service." },
  { q: "Can I sign up myself?", a: "Accounts are created by MECGURA so your number, templates and consent process are set up correctly. Message us and we will set you up." },
  { q: "Do I need a new phone number?", a: "Usually a number that is not already on the regular WhatsApp app. If you already use the WhatsApp Business app, we will check what Meta allows for your number." },
  { q: "Where is my data?", a: "In your private workspace. See our Privacy Policy for what is stored and how to request deletion." },
];

async function loadPlans() {
  try {
    return await db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  } catch {
    return [];
  }
}

const whatsappDigits = siteConfig.contact.whatsapp;
/** 917837722567 → +91 78377 22567 (Indian mobile grouping; other lengths are shown as typed). */
const phoneLabel = /^91\d{10}$/.test(whatsappDigits) ? `+91 ${whatsappDigits.slice(2, 7)} ${whatsappDigits.slice(7)}` : `+${whatsappDigits}`;
const wa = (text: string) => `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(text)}`;

export default async function Landing() {
  const [plans, session] = await Promise.all([loadPlans(), auth().catch(() => null)]);
  const signedIn = Boolean(session?.user);
  const appHref = signedIn ? "/dashboard" : "/login";
  return (
    <div className="clay-root min-h-dvh overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <a href="#channels" className="clay-muted hidden px-3 py-2 text-small font-semibold hover:text-[var(--clay-ink)] md:inline">Channels</a>
          <a href="#pricing" className="clay-muted hidden px-3 py-2 text-small font-semibold hover:text-[var(--clay-ink)] md:inline">Pricing</a>
          <a href="#contact" className="clay-muted hidden px-3 py-2 text-small font-semibold hover:text-[var(--clay-ink)] md:inline">Contact</a>
          <Link href={appHref} className="clay-btn clay-btn-soft !min-h-11 !px-5 text-small">
            {signedIn ? "Open workspace" : "Sign in"}
          </Link>
        </nav>
      </header>

      <main id="main-content">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 lg:grid-cols-2 lg:pt-14">
          <div>
            <p className="clay-card inline-flex items-center gap-2 !rounded-full px-4 py-1.5 text-small font-semibold">
              <Sparkles className="size-4 text-emerald-600" aria-hidden="true" /> WhatsApp and more, for Indian businesses
            </p>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.1] sm:text-5xl lg:text-6xl">
              Every customer chat. <span className="text-emerald-600">One friendly inbox.</span>
            </h1>
            <p className="clay-muted mt-5 max-w-xl text-lg">
              WhatsApp, email, website chat, Messenger and Instagram land in one place. Your team replies together, campaigns stay compliant and an AI agent helps after hours.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a href={wa("Hi MECGURA, I would like a demo of the platform.")} className="clay-btn">
                <MessageCircle className="size-5" aria-hidden="true" /> Book a demo
              </a>
              <Link href={appHref} className="clay-btn clay-btn-soft">
                {signedIn ? "Open workspace" : "Client sign in"}
              </Link>
            </div>
          </div>

          <div className="relative mx-auto h-[28rem] w-full max-w-md" aria-hidden="true">
            <div className="clay-card absolute inset-x-6 top-4 bottom-2 rotate-[-2deg] p-5">
              <div className="clay-pressed flex items-center gap-3 px-4 py-3">
                <span className="clay-blob clay-mint grid size-10 place-items-center"><MessageCircle className="size-5 text-[#06281a]" /></span>
                <div>
                  <p className="text-small font-bold">Customer chat</p>
                  <p className="clay-muted text-caption">replies in minutes</p>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-small">
                <p className="clay-pressed max-w-[78%] px-4 py-3">Hi! Is my order on its way?</p>
                <p className="clay-mint ml-auto max-w-[78%] rounded-[1.25rem] px-4 py-3 font-semibold text-[#06281a] shadow-[6px_8px_16px_rgba(47,191,132,0.35),inset_2px_3px_5px_rgba(255,255,255,0.5)]">Yes! It is out for delivery today.</p>
                <p className="clay-pressed max-w-[70%] px-4 py-3">Great, thank you!</p>
                <p className="clay-lilac ml-auto max-w-[78%] rounded-[1.25rem] px-4 py-3 font-semibold text-[#2a1b6b] shadow-[6px_8px_16px_rgba(130,110,230,0.35),inset_2px_3px_5px_rgba(255,255,255,0.5)]">Anything else we can help with?</p>
              </div>
            </div>
            <span className="clay-blob clay-peach clay-bob absolute -left-1 top-10 grid size-16 place-items-center" style={{ "--r": "-6deg" } as CSSProperties}><Mail className="size-7 text-[#6b2f12]" /></span>
            <span className="clay-blob clay-sky clay-bob absolute -right-1 top-28 grid size-14 place-items-center [animation-delay:-2s]"><Globe className="size-6 text-[#0b3a63]" /></span>
            <span className="clay-blob clay-butter clay-bob absolute bottom-6 left-2 grid size-14 place-items-center [animation-delay:-4s]"><Camera className="size-6 text-[#6b4d00]" /></span>
          </div>
        </section>

        <section id="channels" aria-labelledby="channels-title" className="mx-auto max-w-6xl px-4 py-14">
          <h2 id="channels-title" className="text-center font-display text-3xl font-bold sm:text-4xl">One inbox, every channel</h2>
          <p className="clay-muted mx-auto mt-3 max-w-xl text-center">Customers write where they like. Your team answers from the same screen.</p>
          <ul className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
            {CHANNELS.map((c) => (
              <li key={c.name} className="clay-card flex flex-col items-center px-3 py-6 text-center">
                <span className={`clay-blob ${c.tone} grid size-16 place-items-center`}><c.icon className="size-7 text-[#12241b]" aria-hidden="true" /></span>
                <p className="mt-4 font-bold">{c.name}</p>
                <span className="clay-pressed mt-2 inline-block !rounded-full px-3 py-0.5 text-caption font-semibold">{c.state}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 py-14">
          <h2 id="features" className="text-center font-display text-3xl font-bold sm:text-4xl">Everything your team needs</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_CARDS.map((f) => (
              <div key={f.title} className="clay-card p-6">
                <span className={`clay-blob ${f.tone} grid size-14 place-items-center`}><f.icon className="size-6 text-[#12241b]" aria-hidden="true" /></span>
                <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                <p className="clay-muted mt-1.5">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="how" className="mx-auto max-w-6xl px-4 py-14">
          <h2 id="how" className="text-center font-display text-3xl font-bold sm:text-4xl">How it works</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((st) => (
              <li key={st.n} className="clay-card p-6">
                <span className={`clay-blob ${st.tone} grid size-12 place-items-center text-lg font-bold text-[#12241b]`}>{st.n}</span>
                <h3 className="mt-4 text-lg font-bold">{st.title}</h3>
                <p className="clay-muted mt-1.5">{st.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {plans.length ? (
          <section id="pricing" aria-labelledby="pricing-title" className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="pricing-title" className="text-center font-display text-3xl font-bold sm:text-4xl">Simple plans</h2>
            <p className="clay-muted mx-auto mt-3 max-w-xl text-center">Platform plans in rupees. Meta&apos;s WhatsApp charges are billed by Meta separately.</p>
            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {plans.map((p, i) => (
                <div key={p.id} className={`clay-card flex flex-col p-6 ${plans.length >= 3 && i === 1 ? "ring-4 ring-emerald-400/60" : ""}`}>
                  {plans.length >= 3 && i === 1 ? <span className="clay-blob clay-mint mb-3 inline-block self-start px-3 py-0.5 text-caption font-bold text-[#06281a]">Recommended</span> : null}
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <p className="mt-2 font-display text-4xl font-bold">
                    {p.selfServe ? formatINR(p.priceMonthly) : "Custom"}
                    {p.selfServe ? <span className="clay-muted text-small font-medium"> / month</span> : null}
                  </p>
                  <p className="clay-muted mt-1 text-small">{p.description}</p>
                  <a href={wa(`Hi MECGURA, I am interested in the ${p.name} plan.`)} className="clay-btn clay-btn-soft mt-5 !min-h-11 w-full text-small">
                    {p.selfServe ? "Get started" : "Talk to us"}
                  </a>
                  <ul className="mt-5 space-y-2 text-small">
                    {[
                      `${isUnlimited(p.maxUsers) ? "Unlimited" : p.maxUsers} team members`,
                      `${isUnlimited(p.maxWhatsAppNumbers) ? "Unlimited" : p.maxWhatsAppNumbers} WhatsApp number${p.maxWhatsAppNumbers === 1 ? "" : "s"}`,
                      `${isUnlimited(p.maxMonthlyMessages) ? "Unlimited" : formatNumber(p.maxMonthlyMessages)} messages / month`,
                      ...parseFeatures(p.features).map((k) => FEATURES[k]),
                    ].map((line) => (
                      <li key={line} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section id="contact" aria-labelledby="contact-title" className="mx-auto max-w-4xl px-4 py-14">
          <div className="clay-card p-8 text-center sm:p-12">
            <h2 id="contact-title" className="font-display text-3xl font-bold sm:text-4xl">Let&apos;s talk</h2>
            <p className="clay-muted mx-auto mt-3 max-w-lg">Questions, a demo or setup help. We reply on WhatsApp and email.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <a href={wa("Hi MECGURA, I would like to know more about the platform.")} className="clay-btn w-full"><MessageCircle className="size-5" aria-hidden="true" /> WhatsApp</a>
              <a href={`tel:+${whatsappDigits}`} className="clay-btn clay-btn-soft w-full"><Phone className="size-5" aria-hidden="true" /> {phoneLabel}</a>
              <a href={`mailto:${siteConfig.contact.email}`} className="clay-btn clay-btn-soft w-full !px-3 text-small"><Mail className="size-5 shrink-0" aria-hidden="true" /> {siteConfig.contact.email}</a>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq" className="mx-auto max-w-3xl px-4 py-14">
          <h2 id="faq" className="text-center font-display text-3xl font-bold sm:text-4xl">Questions</h2>
          <div className="mt-8 space-y-4">
            {FAQ.map((f) => (
              <details key={f.q} className="clay-card group px-6 py-4">
                <summary className="cursor-pointer list-none font-bold marker:hidden">{f.q}</summary>
                <p className="clay-muted mt-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6">
        <div className="clay-pressed flex flex-wrap items-center justify-between gap-4 px-6 py-5 text-small">
          <p className="clay-muted">
            © {new Date().getFullYear()} MECGURA · <a href={`mailto:${siteConfig.contact.email}`} className="hover:underline">{siteConfig.contact.email}</a> · <a href={`tel:+${whatsappDigits}`} className="hover:underline">{phoneLabel}</a>
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-5 font-semibold">
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <Link href="/terms" className="hover:underline">Terms</Link>
            <Link href="/data-deletion" className="hover:underline">Data deletion</Link>
            <Link href="/login" className="hover:underline">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
