import Link from "next/link";
import { Clock, ExternalLink, Mail, MapPin, Phone, ShieldAlert } from "lucide-react";
import { Markdown } from "@/components/website/markdown";
import { DAYS, DAY_LABELS, describeDay } from "@/lib/website/content";
import { availablePages } from "@/lib/website/pages";
import { withBase } from "@/lib/website/paths";
import type { PublicArticle, PublicArticleCard, PublicDoctor, PublicService, SiteData } from "@/lib/website/types";
import type { BaseProps } from "../types";
import { Btn, Card, CtaRow, Img, PageHeading, Section, ServiceIcon, Stars, addressLines, mapHref, money } from "./parts";
import { ContactForm } from "./contact-form";

const initials = (n: string) => n.replace(/^(dr\.?\s+)/i, "").split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "");
const DISCLAIMER = "General information only — not a substitute for professional medical advice, diagnosis or treatment.";

function DoctorPhoto({ d, className }: { d: Pick<PublicDoctor, "photoUrl" | "photoAlt" | "name">; className?: string }) {
  return d.photoUrl ? <Img src={d.photoUrl} alt={d.photoAlt || d.name} className={className} /> : <div aria-hidden className={`flex items-center justify-center bg-primary-soft text-4xl font-bold text-primary ${className ?? ""}`}>{initials(d.name)}</div>;
}

export function HoursTable({ site }: { site: SiteData }) {
  const open = DAYS.some((d) => site.content.clinic.hours[d].open);
  if (!open) return null;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Clinic opening hours</caption>
      <tbody>{DAYS.map((d) => <tr key={d} className="border-b border-line last:border-0"><th scope="row" className="py-2 pr-4 text-left font-medium">{DAY_LABELS[d]}</th><td className="py-2 text-muted">{describeDay(site.content.clinic.hours[d])}</td></tr>)}</tbody>
    </table>
  );
}

/* ---------------------------------- Home ---------------------------------- */
export function Home({ site, basePath }: BaseProps) {
  const { content: c, identity: i } = site;
  const on = availablePages(site);
  const solo = site.doctors.length === 1 ? site.doctors[0] : null;
  const headline = c.hero.headline || solo?.name || i.name;
  const sub = c.hero.subheadline || [solo?.specialization, solo?.qualification].filter(Boolean).join(" · ");
  const heroImg = c.hero.imageUrl || solo?.photoUrl || null;
  const heroAlt = c.hero.imageUrl ? c.hero.imageAlt : solo?.photoAlt || solo?.name;
  const trust = solo ? ([["Experience", solo.experienceYears != null ? `${solo.experienceYears} years` : null], ["Qualification", solo.qualification], ["Specialization", solo.specialization], ["Registration", solo.registration]] as [string, string | null][]).filter(([, v]) => v) : [];
  return (
    <>
      <section aria-labelledby="hero-h" className="border-b border-line bg-gradient-to-b from-primary-soft to-surface">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_1fr] md:py-16">
          <div className="space-y-5">
            {sub && <p className="text-sm font-semibold uppercase tracking-wide text-primary">{sub}</p>}
            <h1 id="hero-h" className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">{headline}</h1>
            {c.hero.intro && <p className="max-w-xl text-base text-muted md:text-lg">{c.hero.intro}</p>}
            <CtaRow site={site} base={basePath} />
          </div>
          <div className="mx-auto w-full max-w-sm md:max-w-none">
            {heroImg ? <Img src={heroImg} alt={heroAlt} priority className="aspect-[4/5] w-full rounded-modal object-cover shadow-pop" />
              : <div aria-hidden className="flex aspect-[4/3] w-full items-center justify-center rounded-modal bg-gradient-to-br from-primary to-secondary text-6xl font-bold text-on-brand shadow-pop">{initials(solo?.name ?? i.name)}</div>}
          </div>
        </div>
      </section>

      {c.home.showCredentials && trust.length > 0 && (
        <section aria-label="Credentials" className="border-b border-line">
          <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-4 px-4 py-6 sm:px-6 md:grid-cols-4">
            {trust.map(([k, v]) => <div key={k}><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt><dd className="mt-0.5 text-base font-semibold">{v}</dd></div>)}
          </dl>
        </section>
      )}

      {c.home.showServices && on.has("services") && (
        <Section id="services" title="Services" intro="What we offer.">
          <ServiceGrid services={site.services.slice(0, 6)} base={basePath} />
          {site.services.length > 6 && <p className="mt-6"><Btn href={withBase(basePath, "/services")} variant="outline">All services</Btn></p>}
        </Section>
      )}

      {c.home.showDoctors && on.has("doctors") && (
        <Section id="doctors" title={site.doctors.length > 1 ? "Our doctors" : "Meet the doctor"} tone="soft">
          <DoctorGrid doctors={site.doctors.slice(0, 4)} base={basePath} />
        </Section>
      )}

      {c.home.showTestimonials && on.has("testimonials") && (
        <Section id="testimonials" title="What patients say"><TestimonialList items={site.testimonials.slice(0, 3)} /></Section>
      )}

      {c.home.showFaq && on.has("faq") && (
        <Section id="faq" title="Frequently asked questions" tone="soft"><FaqList faqs={site.faqs.slice(0, 5)} />
          {site.faqs.length > 5 && <p className="mt-6"><Btn href={withBase(basePath, "/faq")} variant="outline">More questions</Btn></p>}</Section>
      )}

      {c.home.showArticles && on.has("articles") && site.articles.length > 0 && (
        <Section id="articles" title="Health articles"><ArticleGrid cards={site.articles.slice(0, 3)} base={basePath} /></Section>
      )}

      <Section id="visit" title="Visit or contact us" tone="soft">
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="space-y-3 text-base">
            {addressLines(site).length > 0 && <p className="flex gap-3"><MapPin aria-hidden className="mt-1 size-5 shrink-0 text-primary" /><span>{addressLines(site).join(", ")}</span></p>}
            {i.phone && <p className="flex gap-3"><Phone aria-hidden className="mt-1 size-5 shrink-0 text-primary" /><a href={`tel:${i.phone}`}>{i.phone}</a></p>}
            {i.email && <p className="flex gap-3"><Mail aria-hidden className="mt-1 size-5 shrink-0 text-primary" /><a href={`mailto:${i.email}`} className="break-all">{i.email}</a></p>}
            {mapHref(site) && <p><a href={mapHref(site)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium">Open in maps <ExternalLink aria-hidden className="size-4" /></a></p>}
          </Card>
          <Card><h3 className="mb-2 flex items-center gap-2 font-semibold"><Clock aria-hidden className="size-5 text-primary" />Opening hours</h3>
            {DAYS.some((d) => c.clinic.hours[d].open) ? <HoursTable site={site} /> : <p className="text-sm text-muted">Please contact the clinic for timings.</p>}</Card>
        </div>
        <div className="mt-8"><CtaRow site={site} base={basePath} /></div>
      </Section>
    </>
  );
}

/* ------------------------------- shared lists ------------------------------- */
export function ServiceGrid({ services, base, level = 3 }: { services: PublicService[]; base: string; level?: 2 | 3 }) {
  const H = `h${level}` as "h2" | "h3";
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {services.map((s) => (
        <li key={s.slug}><Card className="flex h-full flex-col gap-3">
          {s.imageUrl ? <Img src={s.imageUrl} alt={s.imageAlt} className="aspect-[16/9] w-full rounded-lg object-cover" /> : <span aria-hidden className="flex size-11 items-center justify-center rounded-lg bg-primary-soft text-primary"><ServiceIcon name={s.icon} className="size-6" /></span>}
          <H className="text-lg font-semibold"><Link href={withBase(base, `/services/${s.slug}`)} className="!text-ink no-underline hover:underline">{s.title}</Link></H>
          {s.shortDescription && <p className="text-sm text-muted">{s.shortDescription}</p>}
          <p className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm text-muted">{s.durationMinutes != null && <span>{s.durationMinutes} min</span>}{s.fee != null && <span className="font-semibold text-ink">{money(s.fee)}</span>}{s.isDraft && <span className="font-semibold text-warning">Draft</span>}</p>
        </Card></li>
      ))}
    </ul>
  );
}

export function DoctorGrid({ doctors, base, level = 3 }: { doctors: PublicDoctor[]; base: string; level?: 2 | 3 }) {
  const H = `h${level}` as "h2" | "h3";
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {doctors.map((d) => (
        <li key={d.slug}><Card className="flex h-full flex-col gap-3 !p-0 overflow-hidden">
          <DoctorPhoto d={d} className="aspect-[4/3] w-full object-cover" />
          <div className="flex flex-1 flex-col gap-2 p-5">
            <H className="text-lg font-semibold">{d.name}{d.isDraft && <span className="ml-2 text-sm font-semibold text-warning">Draft</span>}</H>
            <p className="text-sm text-muted">{[d.specialization, d.qualification].filter(Boolean).join(" · ")}{d.experienceYears != null ? ` · ${d.experienceYears} yrs experience` : ""}</p>
            {d.shortBio && <p className="text-sm">{d.shortBio}</p>}
            <div className="mt-auto flex flex-wrap gap-2 pt-2"><Btn href={withBase(base, `/doctors/${d.slug}`)} variant="outline" className="min-h-10 px-4 text-sm">View profile</Btn><Btn href={`${withBase(base, "/book-appointment")}?doctor=${d.slug}`} className="min-h-10 px-4 text-sm">Book appointment</Btn></div>
          </div>
        </Card></li>
      ))}
    </ul>
  );
}

export function TestimonialList({ items }: { items: SiteData["testimonials"] }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {items.map((t, i) => (
        <li key={i}><Card className="flex h-full flex-col gap-3">
          {t.rating != null && <Stars rating={t.rating} />}
          <blockquote className="text-base">“{t.text}”</blockquote>
          <p className="mt-auto text-sm text-muted"><span className="font-semibold text-ink">{t.name}</span>{t.date ? ` · ${fmtDate(t.date)}` : ""}{t.doctorName ? ` · ${t.doctorName}` : ""}{t.serviceTitle ? ` · ${t.serviceTitle}` : ""}{t.isDraft && <span className="ml-2 font-semibold text-warning">Draft</span>}</p>
        </Card></li>
      ))}
    </ul>
  );
}

/** Accessible accordion with native <details> — no JavaScript needed. */
export function FaqList({ faqs }: { faqs: SiteData["faqs"] }) {
  return (
    <div className="space-y-3">
      {faqs.map((f, i) => (
        <details key={i} className="group rounded-card border border-line bg-surface shadow-card open:shadow-pop">
          <summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-3 text-base font-semibold [&::-webkit-details-marker]:hidden">
            <span>{f.question}{f.isDraft && <span className="ml-2 text-sm text-warning">Draft</span>}</span>
            <span aria-hidden className="text-xl leading-none text-primary transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="px-5 pb-4"><Markdown text={f.answer} /></div>
        </details>
      ))}
    </div>
  );
}

export function ArticleGrid({ cards, base, level = 3 }: { cards: PublicArticleCard[]; base: string; level?: 2 | 3 }) {
  const H = `h${level}` as "h2" | "h3";
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((a) => (
        <li key={a.slug}><Card className="flex h-full flex-col gap-3 !p-0 overflow-hidden">
          {a.imageUrl && <Img src={a.imageUrl} alt={a.imageAlt} className="aspect-[16/9] w-full object-cover" />}
          <div className="flex flex-1 flex-col gap-2 p-5">
            {a.category && <p className="text-xs font-semibold uppercase tracking-wide text-primary">{a.category}</p>}
            <H className="text-lg font-semibold"><Link href={withBase(base, `/articles/${a.slug}`)} className="!text-ink no-underline hover:underline">{a.title}</Link></H>
            {a.excerpt && <p className="text-sm text-muted">{a.excerpt}</p>}
            <p className="mt-auto pt-1 text-xs text-muted">{a.author}{a.publishedAt ? ` · ${fmtDate(a.publishedAt)}` : ""}{a.isDraft && <span className="ml-2 font-semibold text-warning">Draft</span>}</p>
          </div>
        </Card></li>
      ))}
    </ul>
  );
}

/* ---------------------------------- pages ---------------------------------- */
export function About({ site }: BaseProps) {
  const { content: c } = site;
  const solo = site.doctors.length === 1 ? site.doctors[0] : null;
  return (
    <>
      <PageHeading title={c.about.title || (solo ? `About ${solo.name}` : `About ${site.identity.name}`)} />
      <Section>
        <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
          {solo && <div className="space-y-3"><DoctorPhoto d={solo} className="aspect-[4/5] w-full rounded-modal object-cover" />
            <p className="text-sm text-muted">{[solo.qualification, solo.specialization].filter(Boolean).join(" · ")}</p></div>}
          <div className="space-y-8">
            <Markdown text={c.about.body || solo?.bio || c.hero.intro} />
            {(c.about.education || solo?.education) && <div><h2 className="mb-2 text-xl font-semibold">Education</h2><Markdown text={c.about.education || solo?.education} /></div>}
            {solo && solo.certifications.length > 0 && <div><h2 className="mb-2 text-xl font-semibold">Certifications</h2><ul className="list-disc space-y-1 pl-5">{solo.certifications.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            {solo && solo.memberships.length > 0 && <div><h2 className="mb-2 text-xl font-semibold">Memberships</h2><ul className="list-disc space-y-1 pl-5">{solo.memberships.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            {solo && solo.languages.length > 0 && <p><span className="font-semibold">Languages: </span>{solo.languages.join(", ")}</p>}
            {(c.about.philosophy || solo?.philosophy) && <div><h2 className="mb-2 text-xl font-semibold">Approach</h2><Markdown text={c.about.philosophy || solo?.philosophy} /></div>}
          </div>
        </div>
      </Section>
    </>
  );
}

export function Services({ site, basePath }: BaseProps) {
  return (<><PageHeading title="Services" intro="Consultations and care we offer." /><Section><ServiceGrid services={site.services} base={basePath} level={2} /></Section></>);
}

export function ServiceDetail({ site, basePath, service: s }: BaseProps & { service: PublicService }) {
  const solo = site.doctors.length === 1 ? site.doctors[0] : null;
  return (
    <>
      <PageHeading title={s.title} intro={s.shortDescription ?? undefined} crumbs={[{ label: "Home", href: withBase(basePath, "/") }, { label: "Services", href: withBase(basePath, "/services") }, { label: s.title }]} />
      <Section>
        <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            {s.imageUrl && <Img src={s.imageUrl} alt={s.imageAlt} priority className="aspect-[16/9] w-full rounded-card object-cover" />}
            <Markdown text={s.description} />
            <p className="text-sm text-muted">{DISCLAIMER}</p>
          </div>
          <aside className="space-y-4">
            <Card className="space-y-3">
              <dl className="space-y-2 text-sm">
                {s.category && <div className="flex justify-between gap-4"><dt className="text-muted">Category</dt><dd className="font-medium">{s.category}</dd></div>}
                {s.durationMinutes != null && <div className="flex justify-between gap-4"><dt className="text-muted">Duration</dt><dd className="font-medium">{s.durationMinutes} min</dd></div>}
                {s.fee != null && <div className="flex justify-between gap-4"><dt className="text-muted">Consultation fee</dt><dd className="font-medium">{money(s.fee)}</dd></div>}
                {solo && <div className="flex justify-between gap-4"><dt className="text-muted">Doctor</dt><dd className="font-medium">{solo.name}</dd></div>}
                <div className="flex justify-between gap-4"><dt className="text-muted">Clinic</dt><dd className="font-medium">{site.identity.name}</dd></div>
              </dl>
              <CtaRow site={site} base={basePath} />
            </Card>
          </aside>
        </div>
      </Section>
    </>
  );
}

export function Doctors({ site, basePath }: BaseProps) {
  return (<><PageHeading title={site.doctors.length > 1 ? "Our doctors" : "Our doctor"} /><Section><DoctorGrid doctors={site.doctors} base={basePath} level={2} /></Section></>);
}

export function DoctorDetail({ basePath, doctor: d }: BaseProps & { doctor: PublicDoctor }) {
  return (
    <>
      <PageHeading title={d.name} intro={[d.specialization, d.qualification].filter(Boolean).join(" · ") || undefined} crumbs={[{ label: "Home", href: withBase(basePath, "/") }, { label: "Doctors", href: withBase(basePath, "/doctors") }, { label: d.name }]} />
      <Section>
        <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
          <div className="space-y-4">
            <DoctorPhoto d={d} className="aspect-[4/5] w-full rounded-modal object-cover" />
            <Card className="space-y-2 text-sm">
              {d.experienceYears != null && <p><span className="text-muted">Experience: </span><strong>{d.experienceYears} years</strong></p>}
              {d.registration && <p><span className="text-muted">Registration: </span><strong>{d.registration}</strong></p>}
              {d.fee != null && <p><span className="text-muted">Consultation fee: </span><strong>{money(d.fee)}</strong></p>}
              {d.languages.length > 0 && <p><span className="text-muted">Languages: </span><strong>{d.languages.join(", ")}</strong></p>}
            </Card>
            <Btn href={`${withBase(basePath, "/book-appointment")}?doctor=${d.slug}`} className="w-full">Book appointment</Btn>
          </div>
          <div className="space-y-8">
            <Markdown text={d.bio || d.shortBio} />
            {d.education && <div><h2 className="mb-2 text-xl font-semibold">Education</h2><Markdown text={d.education} /></div>}
            {d.certifications.length > 0 && <div><h2 className="mb-2 text-xl font-semibold">Certifications</h2><ul className="list-disc space-y-1 pl-5">{d.certifications.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            {d.memberships.length > 0 && <div><h2 className="mb-2 text-xl font-semibold">Memberships</h2><ul className="list-disc space-y-1 pl-5">{d.memberships.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            {d.philosophy && <div><h2 className="mb-2 text-xl font-semibold">Approach</h2><Markdown text={d.philosophy} /></div>}
          </div>
        </div>
      </Section>
    </>
  );
}

export function Clinic({ site }: BaseProps) {
  const { content: c, identity: i } = site;
  return (
    <>
      <PageHeading title={i.name} intro="Clinic information" />
      <Section>
        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-6">
            <Markdown text={c.clinic.description} />
            {c.clinic.facilities.length > 0 && <div><h2 className="mb-2 text-xl font-semibold">Facilities</h2><ul className="list-disc space-y-1 pl-5">{c.clinic.facilities.map((f) => <li key={f}>{f}</li>)}</ul></div>}
            {c.clinic.parking && <div><h2 className="mb-2 text-xl font-semibold">Parking</h2><p>{c.clinic.parking}</p></div>}
          </div>
          <div className="space-y-4">
            <Card className="space-y-3">
              <h2 className="text-lg font-semibold">Find us</h2>
              {addressLines(site).length > 0 && <p className="flex gap-3"><MapPin aria-hidden className="mt-1 size-5 shrink-0 text-primary" /><span>{addressLines(site).join(", ")}</span></p>}
              {i.phone && <p className="flex gap-3"><Phone aria-hidden className="mt-1 size-5 shrink-0 text-primary" /><a href={`tel:${i.phone}`}>{i.phone}</a></p>}
              {i.email && <p className="flex gap-3"><Mail aria-hidden className="mt-1 size-5 shrink-0 text-primary" /><a href={`mailto:${i.email}`} className="break-all">{i.email}</a></p>}
              {mapHref(site) && <p><a href={mapHref(site)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium">Open in maps <ExternalLink aria-hidden className="size-4" /></a></p>}
              {c.clinic.emergencyContact && <p className="flex gap-3 rounded-lg bg-emergency-soft p-3 text-sm"><ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-emergency" /><span><strong>Emergency contact:</strong> <a href={`tel:${c.clinic.emergencyContact}`}>{c.clinic.emergencyContact}</a></span></p>}
            </Card>
            {DAYS.some((d) => c.clinic.hours[d].open) && <Card><h2 className="mb-2 flex items-center gap-2 text-lg font-semibold"><Clock aria-hidden className="size-5 text-primary" />Opening hours</h2><HoursTable site={site} /></Card>}
          </div>
        </div>
      </Section>
    </>
  );
}

export function Testimonials({ site }: BaseProps) {
  return (<><PageHeading title="Patient feedback" intro="Shared by patients with their permission. Individual experiences vary." /><Section><TestimonialList items={site.testimonials} /></Section></>);
}

export function Faq({ site }: BaseProps) {
  const cats = [...new Set(site.faqs.map((f) => f.category ?? ""))];
  return (
    <>
      <PageHeading title="Frequently asked questions" />
      <Section><div className="space-y-10">{cats.map((cat) => <div key={cat}>{cat && <h2 className="mb-3 text-xl font-semibold">{cat}</h2>}<FaqList faqs={site.faqs.filter((f) => (f.category ?? "") === cat)} /></div>)}</div></Section>
    </>
  );
}

export function Articles({ basePath, cards, page, pageCount }: BaseProps & { cards: PublicArticleCard[]; page: number; pageCount: number }) {
  const href = (p: number) => `${withBase(basePath, "/articles")}${p > 1 ? `?page=${p}` : ""}`;
  return (
    <>
      <PageHeading title="Health articles" intro="Informational articles from the clinic. Not a substitute for professional medical advice." />
      <Section>
        <ArticleGrid cards={cards} base={basePath} level={2} />
        {pageCount > 1 && <nav aria-label="Article pages" className="mt-8 flex items-center justify-between"><span className="text-sm text-muted">Page {page} of {pageCount}</span>
          <span className="flex gap-2">{page > 1 && <Btn href={href(page - 1)} variant="outline">Previous</Btn>}{page < pageCount && <Btn href={href(page + 1)} variant="outline">Next</Btn>}</span></nav>}
      </Section>
    </>
  );
}

export function ArticleDetail({ basePath, article: a }: BaseProps & { article: PublicArticle }) {
  return (
    <>
      <PageHeading title={a.title} intro={a.excerpt ?? undefined} crumbs={[{ label: "Home", href: withBase(basePath, "/") }, { label: "Articles", href: withBase(basePath, "/articles") }, { label: a.title }]} />
      <Section>
        <article className="mx-auto max-w-3xl space-y-6">
          <p className="text-sm text-muted">{a.author}{a.publishedAt ? ` · ${fmtDate(a.publishedAt)}` : ""}{a.updatedAt.getTime() - (a.publishedAt?.getTime() ?? 0) > 86_400_000 ? ` · Updated ${fmtDate(a.updatedAt)}` : ""}{a.category ? ` · ${a.category}` : ""}</p>
          {a.imageUrl && <Img src={a.imageUrl} alt={a.imageAlt} priority className="aspect-[16/9] w-full rounded-card object-cover" />}
          <Markdown text={a.content} />
          {a.tags.length > 0 && <ul className="flex flex-wrap gap-2">{a.tags.map((t) => <li key={t} className="rounded-pill bg-surface-muted px-3 py-1 text-xs font-medium">{t}</li>)}</ul>}
          <p className="rounded-lg border border-line bg-surface-muted p-4 text-sm text-muted">This article is for general information only and is not a substitute for professional medical advice, diagnosis or treatment. Please consult a qualified doctor about your own health.</p>
        </article>
      </Section>
    </>
  );
}

export function Contact({ site }: BaseProps) {
  const { content: c, identity: i } = site;
  return (
    <>
      <PageHeading title="Contact" intro={c.contact.intro || undefined} />
      <Section>
        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-4">
            <Card className="space-y-3">
              <h2 className="text-lg font-semibold">{i.name}</h2>
              {addressLines(site).length > 0 && <p className="flex gap-3"><MapPin aria-hidden className="mt-1 size-5 shrink-0 text-primary" /><span>{addressLines(site).join(", ")}</span></p>}
              {i.phone && <p className="flex gap-3"><Phone aria-hidden className="mt-1 size-5 shrink-0 text-primary" /><a href={`tel:${i.phone}`}>{i.phone}</a></p>}
              {i.email && <p className="flex gap-3"><Mail aria-hidden className="mt-1 size-5 shrink-0 text-primary" /><a href={`mailto:${i.email}`} className="break-all">{i.email}</a></p>}
              {mapHref(site) && <p><a href={mapHref(site)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium">Open in maps <ExternalLink aria-hidden className="size-4" /></a></p>}
              {site.whatsappLink && <p><Btn href={site.whatsappLink} variant="whatsapp" external>Chat on WhatsApp</Btn></p>}
            </Card>
            {DAYS.some((d) => c.clinic.hours[d].open) && <Card><h2 className="mb-2 text-lg font-semibold">Opening hours</h2><HoursTable site={site} /></Card>}
          </div>
          {c.contact.showForm && <Card><h2 className="mb-4 text-lg font-semibold">Send a message</h2><ContactForm disabled={site.mode === "preview"} /></Card>}
        </div>
      </Section>
    </>
  );
}

export function Legal({ title, text }: BaseProps & { title: string; text: string }) {
  return (<><PageHeading title={title} /><Section><div className="mx-auto max-w-3xl"><Markdown text={text} /></div></Section></>);
}

/**
 * Online booking arrives with the appointment engine (a later phase). Until then this page is an honest set-up state:
 * it never shows a form, a slot picker or a confirmation.
 */
export function Appointments({ site, basePath, doctor }: BaseProps & { doctor?: PublicDoctor | null }) {
  const { identity: i } = site;
  return (
    <>
      <PageHeading title="Book an appointment" intro={doctor ? `With ${doctor.name}` : undefined} />
      <Section>
        <div className="mx-auto max-w-2xl space-y-6">
          <div role="status" className="rounded-card border border-info/30 bg-info-soft p-5">
            <h2 className="text-lg font-semibold">Online booking isn&apos;t available yet</h2>
            <p className="mt-1 text-muted">This clinic hasn&apos;t switched on online appointments. Please contact the clinic directly to arrange a visit.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {i.phone && <Btn href={`tel:${i.phone}`}>Call {i.phone}</Btn>}
            {site.whatsappLink && <Btn href={site.whatsappLink} variant="whatsapp" external>WhatsApp</Btn>}
            <Link href={withBase(basePath, "/contact")} className="type-button inline-flex min-h-control items-center rounded-md border border-line-strong px-5 !text-ink no-underline hover:bg-surface-muted">Send a message</Link>
          </div>
          <p className="text-sm text-muted">In an emergency, please contact your local emergency services.</p>
        </div>
      </Section>
    </>
  );
}
