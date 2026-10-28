import type { Metadata } from "next";
import type * as React from "react";
import Link from "next/link";
import { BadgeCheck, Bot, Camera, Check, CheckCheck, Globe, Mail, Megaphone, MessageCircle, MessagesSquare, Phone, Plug, Smartphone, Sparkles, Workflow } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { siteConfig } from "@/config/site";
import { formatINR, formatNumber } from "@/lib/catalog";
import { FEATURES, isUnlimited, parseFeatures } from "@/lib/plans";
import { Logo } from "@/components/layout/logo";
import { getHomeContent } from "@/services/site/home-content";
import { festivalPromo, festivePrice, getFestivals, istToday, previewPromo } from "@/services/site/festivals";
import { getSessionUser } from "@/lib/session";
import { FestivalSiteBanner } from "@/components/festival/festival-banner";
import { FestivalPromoBar, FestivalPromoPopup, FestivePriceTag, type PublicPromo } from "@/components/festival/festival-promo";
import { FestivalCalendar } from "@/components/festival/festival-calendar";
import { FloatingChat } from "@/components/home/floating-chat";
import { ScrollReveal } from "@/components/home/scroll-reveal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "MECGURA: WhatsApp inbox, campaigns and AI for your business" },
  description: siteConfig.description,
  robots: { index: true, follow: true },
};

const SERVICE_ICONS = [MessageCircle, Megaphone, Workflow, Bot, Sparkles, Smartphone, Mail, Globe];

const CHANNELS = [
  { icon: MessageCircle, name: "WhatsApp", soon: false },
  { icon: Mail, name: "Email", soon: false },
  { icon: Globe, name: "Website chat", soon: false },
  { icon: MessagesSquare, name: "Messenger", soon: false },
  { icon: Camera, name: "Instagram", soon: false },
  { icon: Smartphone, name: "SMS", soon: true },
  { icon: Smartphone, name: "RCS", soon: true },
  { icon: Phone, name: "AI calling", soon: true },
];

const STEPS = [
  { n: "1", title: "We set you up", text: "MECGURA creates your workspace, connects your WhatsApp number and gets templates approved." },
  { n: "2", title: "Bring your contacts", text: "Import your list with consent. Opt-outs are respected automatically." },
  { n: "3", title: "Chat and campaign", text: "Your team replies from one inbox while campaigns and automations run in the background." },
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
const endsFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
/** 917837722567 → +91 78377 22567 (Indian mobile grouping; other lengths are shown as typed). */
const phoneLabel = /^91\d{10}$/.test(whatsappDigits) ? `+91 ${whatsappDigits.slice(2, 7)} ${whatsappDigits.slice(7)}` : `+${whatsappDigits}`;
const wa = (text: string) => `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(text)}`;

export default async function Landing({ searchParams }: { searchParams: Promise<{ festivalPreview?: string; phase?: string }> }) {
  const [plans, session, content, festivals, sp] = await Promise.all([loadPlans(), auth().catch(() => null), getHomeContent(), getFestivals(), searchParams]);
  const today = istToday();
  // ?festivalPreview=<id>&phase=pre|live lets the Super Admin see any festival's offer early; everyone else gets today's.
  const wantsPreview = typeof sp.festivalPreview === "string" && /^[a-z0-9-]{1,40}$/.test(sp.festivalPreview);
  const viewer = wantsPreview ? await getSessionUser().catch(() => null) : null;
  const previewing = Boolean(wantsPreview && viewer?.platformRole === "SUPER_ADMIN");
  const promo = previewing ? previewPromo(festivals, sp.festivalPreview!, sp.phase === "live" ? "live" : "pre", today) : festivalPromo(festivals, today);
  const festival = promo?.festival ?? null;
  const dateLabel = (iso: string) => endsFmt.format(new Date(`${iso}T00:00:00Z`));
  const publicPromo: PublicPromo | null = promo
    ? { id: promo.festival.id, name: promo.festival.name, emoji: promo.festival.emoji, phase: promo.phase, offer: promo.offer, offerCode: promo.festival.offerCode, discountPercent: promo.festival.discountPercent, startsOn: promo.startsOn, endsOn: promo.endsOn, startLabel: dateLabel(promo.startsOn), endLabel: dateLabel(promo.endsOn) }
    : null;
  const planDiscount = promo && promo.festival.applyToPlans && promo.festival.discountPercent > 0 ? promo.festival.discountPercent : 0;
  const calendar = festivals.enabled ? festivals.festivals.filter((x) => x.showOnSite).map((x) => ({ id: x.id, name: x.name, emoji: x.emoji, start: x.start, days: x.days })) : [];
  const signedIn = Boolean(session?.user);
  const appHref = signedIn ? "/dashboard" : "/login";
  return (
    <div className="wa-root min-h-dvh overflow-x-hidden" data-festival-theme={promo && promo.theme !== "none" ? promo.theme : undefined}>
      <ScrollReveal />
      {previewing ? (
        <div className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-black/85 px-4 py-2 text-center text-xs font-semibold text-white shadow-lg">
          {promo ? `Preview: ${promo.festival.name} (${promo.phase === "pre" ? "days before" : "festival day"}). Only you can see this.` : "Preview: festival not found. Save it first."}{" "}
          <Link href="/admin/festivals" className="underline">Back to Festivals</Link>
        </div>
      ) : null}
      <header className="wa-topbar sticky top-0 z-30">
        {publicPromo ? <FestivalPromoBar promo={publicPromo} whatsapp={whatsappDigits} /> : null}
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Logo tone="light" />
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <a href="#services" className="wa-muted hidden px-3 py-2 text-small font-semibold hover:text-[var(--wa-ink)] md:inline">Services</a>
            <a href="#channels" className="wa-muted hidden px-3 py-2 text-small font-semibold hover:text-[var(--wa-ink)] md:inline">Channels</a>
            {plans.length ? <a href="#pricing" className="wa-muted hidden px-3 py-2 text-small font-semibold hover:text-[var(--wa-ink)] md:inline">Pricing</a> : null}
            <a href="#contact" className="wa-muted hidden px-3 py-2 text-small font-semibold hover:text-[var(--wa-ink)] md:inline">Contact</a>
            <Link href={appHref} className="wa-btn !min-h-10 !px-5 text-small">{signedIn ? "Open workspace" : "Sign in"}</Link>
          </nav>
        </div>
      </header>

      <main id="main-content">
        {festival ? (
          <FestivalSiteBanner
            preview={previewing}
            whatsapp={whatsappDigits}
            festival={{ ...festival, offer: promo?.offer ?? festival.offer, phase: promo?.phase, startLabel: publicPromo?.startLabel, photoUrl: festival.hasPhoto ? `/api/festival-photo/${festival.id}` : null, endsLabel: publicPromo?.endLabel ?? "" }}
          />
        ) : null}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 lg:grid-cols-2 lg:pt-16">
          <div>
            <p className="wa-pill"><BadgeCheck className="size-3.5" aria-hidden="true" /> Official WhatsApp Business Platform</p>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.1] sm:text-5xl lg:text-6xl">
              Talk to your customers where they already are.
            </h1>
            <p className="wa-muted mt-5 max-w-xl text-lg">
              WhatsApp, Instagram, Messenger, email and website chat land in one inbox. Your team replies together, campaigns stay compliant and an AI agent helps after hours.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={wa("Hi MECGURA, I would like a demo of the platform.")} className="wa-btn"><MessageCircle className="size-5" aria-hidden="true" /> Book a demo on WhatsApp</a>
              <Link href={appHref} className="wa-btn wa-btn-ghost">{signedIn ? "Open workspace" : "Client sign in"}</Link>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm" aria-hidden="true">
            <div className="overflow-hidden rounded-[1.75rem] border border-[var(--wa-line)] bg-white shadow-xl">
              <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
                <span className="grid size-9 place-items-center rounded-full bg-white/15 font-bold">S</span>
                <div>
                  <p className="text-sm font-bold leading-tight">Sharma Sweets</p>
                  <p className="text-xs text-white/80">online</p>
                </div>
              </div>
              <div className="wa-chat-bg flex min-h-[21rem] flex-col gap-2.5 p-4">
                <p className="wa-bubble wa-in wa-seq" style={{ "--d": "0.3s" } as React.CSSProperties}>Hi! Is my Diwali box order on its way?<span className="wa-time">10:42</span></p>
                <p className="wa-bubble wa-out wa-seq" style={{ "--d": "1.4s" } as React.CSSProperties}>Yes! It is out for delivery today. Track it here: sharma.in/t/4821<span className="wa-time">10:42 <CheckCheck className="wa-ticks inline size-3.5" /></span></p>
                <p className="wa-bubble wa-in wa-seq" style={{ "--d": "2.6s" } as React.CSSProperties}>Great, thank you!<span className="wa-time">10:43</span></p>
                <p className="wa-bubble wa-out wa-seq" style={{ "--d": "3.6s" } as React.CSSProperties}>Anything else we can help with? 😊<span className="wa-time">10:43 <CheckCheck className="wa-ticks inline size-3.5" /></span></p>
                <p className="wa-bubble wa-in wa-seq !w-16" style={{ "--d": "4.6s" } as React.CSSProperties}><span className="wa-dot" /><span className="wa-dot" /><span className="wa-dot" /></p>
              </div>
            </div>
          </div>
        </section>

        {content.services.length ? (
          <section id="services" aria-labelledby="services-title" className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="services-title" data-reveal className="text-center font-display text-3xl font-bold sm:text-4xl">What we do for you</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {content.services.map((sv, i) => {
                const Icon = SERVICE_ICONS[i % SERVICE_ICONS.length];
                return (
                  <div key={sv.id} data-reveal style={{ "--d": `${(i % 3) * 0.08}s` } as React.CSSProperties} className="wa-card p-6">
                    <div className="flex items-start justify-between gap-3">
                      <span className="wa-icon"><Icon className="size-5" aria-hidden="true" /></span>
                      {sv.state === "soon" ? <span className="wa-pill wa-pill-soon">Coming soon</span> : null}
                    </div>
                    <h3 className="mt-4 text-lg font-bold">{sv.title}</h3>
                    <p className="wa-muted mt-1.5">{sv.text}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section id="channels" aria-labelledby="channels-title" className="wa-band">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="channels-title" data-reveal className="text-center font-display text-3xl font-bold sm:text-4xl">One inbox, every channel</h2>
            <p data-reveal className="mx-auto mt-3 max-w-xl text-center text-white/80">Customers write where they like. Your team answers from the same screen.</p>
            <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {CHANNELS.map((c, i) => (
                <li key={c.name} data-reveal style={{ "--d": `${(i % 4) * 0.07}s` } as React.CSSProperties} className="rounded-2xl bg-white/10 p-5 text-center ring-1 ring-white/15">
                  <c.icon className="mx-auto size-7" aria-hidden="true" />
                  <p className="mt-3 font-bold">{c.name}</p>
                  <span className={`mt-2 inline-block rounded-full px-3 py-0.5 text-caption font-semibold ${c.soon ? "bg-[#fff4d6] text-[#7a5a00]" : "bg-[#25d366] text-[#06281a]"}`}>{c.soon ? "Coming soon" : "Live"}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {content.integrations.length ? (
          <section aria-labelledby="integrations-title" className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="integrations-title" data-reveal className="text-center font-display text-3xl font-bold sm:text-4xl">Works with the tools you use</h2>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {content.integrations.map((it, i) => (
                <li key={it.id} data-reveal style={{ "--d": `${(i % 3) * 0.07}s` } as React.CSSProperties} className="wa-card flex items-center gap-4 p-4">
                  <span className="wa-icon shrink-0"><Plug className="size-5" aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{it.name}</p>
                    {it.note ? <p className="wa-muted truncate text-small">{it.note}</p> : null}
                  </div>
                  <span className={`wa-pill shrink-0 ${it.state === "soon" ? "wa-pill-soon" : ""}`}>{it.state === "soon" ? "Soon" : "Live"}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="how" className="mx-auto max-w-6xl px-4 py-14">
          <h2 id="how" data-reveal className="text-center font-display text-3xl font-bold sm:text-4xl">How it works</h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((st, i) => (
              <li key={st.n} data-reveal style={{ "--d": `${i * 0.1}s` } as React.CSSProperties} className="wa-card p-6">
                <span className="grid size-10 place-items-center rounded-full bg-[#128c7e] text-lg font-bold text-white">{st.n}</span>
                <h3 className="mt-4 text-lg font-bold">{st.title}</h3>
                <p className="wa-muted mt-1.5">{st.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {calendar.length ? (
          <section id="festivals" aria-labelledby="festivals-title" className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="festivals-title" data-reveal className="text-center font-display text-3xl font-bold sm:text-4xl">Festival calendar</h2>
            <p data-reveal className="wa-muted mx-auto mt-3 max-w-xl text-center">Plan your festival campaigns early. We help you send greetings and offers to your customers on WhatsApp.</p>
            <div data-reveal className="mt-10">
              <FestivalCalendar festivals={calendar} today={today} />
            </div>
          </section>
        ) : null}

        {content.team.length ? (
          <section aria-labelledby="team-title" className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="team-title" data-reveal className="text-center font-display text-3xl font-bold sm:text-4xl">Our team</h2>
            <ul className="mt-10 flex flex-wrap justify-center gap-5">
              {content.team.map((m, i) => (
                <li key={m.id} data-reveal style={{ "--d": `${(i % 4) * 0.07}s` } as React.CSSProperties} className="wa-card w-[calc(50%-0.625rem)] p-5 text-center sm:w-52">
                  {m.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.photo} alt={m.name} width={96} height={96} loading="lazy" className="mx-auto size-24 rounded-full object-cover" />
                  ) : (
                    <span className="mx-auto grid size-24 place-items-center rounded-full bg-[#e7f7ee] text-2xl font-bold text-[#075e54]" aria-hidden="true">
                      {m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                  )}
                  <p className="mt-3 font-bold">{m.name}</p>
                  {m.role ? <p className="text-small font-semibold text-[#128c7e]">{m.role}</p> : null}
                  {m.bio ? <p className="wa-muted mt-1 text-small">{m.bio}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {plans.length ? (
          <section id="pricing" aria-labelledby="pricing-title" className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="pricing-title" data-reveal className="text-center font-display text-3xl font-bold sm:text-4xl">Simple plans</h2>
            <p data-reveal className="wa-muted mx-auto mt-3 max-w-xl text-center">Platform plans in rupees. Meta&apos;s WhatsApp charges are billed by Meta separately.</p>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {plans.map((p, i) => (
                <div key={p.id} data-reveal style={{ "--d": `${i * 0.07}s` } as React.CSSProperties} className={`wa-card flex flex-col p-6 ${plans.length >= 3 && i === 1 ? "!border-[#128c7e] ring-2 ring-[#128c7e]/30" : ""}`}>
                  {plans.length >= 3 && i === 1 ? <span className="wa-pill mb-3 self-start">Recommended</span> : null}
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  {p.selfServe && planDiscount && p.priceMonthly > 0 && festival ? (
                    <div className="mt-2">
                      <FestivePriceTag percent={planDiscount} name={festival.name} />
                      <p className="mt-2 font-display text-4xl font-bold">
                        {formatINR(festivePrice(p.priceMonthly, planDiscount))}
                        <span className="wa-muted text-small font-medium"> / month</span>
                      </p>
                      <p className="wa-muted text-small"><s>{formatINR(p.priceMonthly)}</s> · festive price till {publicPromo?.endLabel}</p>
                    </div>
                  ) : (
                    <p className="mt-2 font-display text-4xl font-bold">
                      {p.selfServe ? formatINR(p.priceMonthly) : "Custom"}
                      {p.selfServe ? <span className="wa-muted text-small font-medium"> / month</span> : null}
                    </p>
                  )}
                  <p className="wa-muted mt-1 text-small">{p.description}</p>
                  <a href={wa(`Hi MECGURA, I am interested in the ${p.name} plan${planDiscount && festival ? ` with the ${festival.name} offer${festival.offerCode ? ` (${festival.offerCode})` : ""}` : ""}.`)} className="wa-btn wa-btn-ghost mt-5 !min-h-11 w-full text-small">
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
                        <Check className="mt-0.5 size-4 shrink-0 text-[#128c7e]" aria-hidden="true" />
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
          <div data-reveal className="wa-card p-8 text-center sm:p-12">
            <h2 id="contact-title" className="font-display text-3xl font-bold sm:text-4xl">Let&apos;s talk</h2>
            <p className="wa-muted mx-auto mt-3 max-w-lg">Questions, a demo or setup help. We reply on WhatsApp and email.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <a href={wa("Hi MECGURA, I would like to know more about the platform.")} className="wa-btn w-full"><MessageCircle className="size-5" aria-hidden="true" /> WhatsApp</a>
              <a href={`tel:+${whatsappDigits}`} className="wa-btn wa-btn-ghost w-full"><Phone className="size-5" aria-hidden="true" /> {phoneLabel}</a>
              <a href={`mailto:${siteConfig.contact.email}`} className="wa-btn wa-btn-ghost w-full !px-3 text-small"><Mail className="size-5 shrink-0" aria-hidden="true" /> {siteConfig.contact.email}</a>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq" className="mx-auto max-w-3xl px-4 py-14">
          <h2 id="faq" data-reveal className="text-center font-display text-3xl font-bold sm:text-4xl">Questions</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} data-reveal className="wa-card px-6 py-4">
                <summary className="cursor-pointer list-none font-bold marker:hidden">{f.q}</summary>
                <p className="wa-muted mt-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--wa-line)] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-small">
          <p className="wa-muted">
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
      {publicPromo ? <FestivalPromoPopup promo={publicPromo} whatsapp={whatsappDigits} preview={previewing} /> : null}
      <FloatingChat digits={whatsappDigits} />
    </div>
  );
}
