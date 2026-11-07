import type { Metadata } from "next";
import Link from "next/link";
import { Crumbs, FaqList, JsonLd, LeadSection, SeoFrame, faqLd } from "@/components/site/seo-blocks";
import { ChatExample } from "@/components/site/seo-blocks";
import { siteConfig } from "@/config/site";

const PATH = "/hi";
export const metadata: Metadata = {
  title: "WhatsApp automation apne business ke liye | MECGURA (Hinglish)",
  description: "Customer ka har WhatsApp message turant reply, booking, price list aur lead follow-up. MECGURA aapke business ke liye sab set up karta hai. Hinglish mein jaankari.",
  alternates: { canonical: PATH, languages: { "en-IN": "/", "hi-Latn": PATH } },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}${PATH}`, title: "WhatsApp automation, Hinglish mein", siteName: "MECGURA", locale: "hi_IN" },
};

const FAQS = [
  { q: "Kya mujhe naya number lena padega?", a: "Aam taur par nahi. Setup aapke maujooda business number par hi hota hai." },
  { q: "Set up kaun karta hai?", a: "Hamari team. Aapko bas apna business batana hai. Lagbhag ek din mein sab ready ho jaata hai." },
  { q: "Kya customers ko spam jaayega?", a: "Nahi. Offers sirf unhi customers ko jaate hain jinhone message lene ki permission di hai, aur wo kabhi bhi STOP likh sakte hain." },
  { q: "Kharcha kitna aata hai?", a: "Hamare plans homepage par hain. Meta ke per-message charges Meta khud alag se bill karta hai. Apna andaza free calculator se lagaayein." },
  { q: "Hindi ya Punjabi mein reply ho sakte hain?", a: "Haan. Messages Hinglish ya kisi bhi bhasha mein likhe ja sakte hain. Jo customer apni bhasha mein baat karna chahe, use aapki team ko de diya jaata hai." },
];

export default function Page() {
  return (
    <SeoFrame crumbs={[{ name: "Hinglish", path: PATH }]}>
      <JsonLd data={faqLd(FAQS)} />
      <div lang="hi-Latn">
        <Crumbs items={[{ name: "Home", href: "/" }, { name: "Hinglish" }]} />
        <div className="mt-3 grid items-start gap-10 lg:grid-cols-[1fr_340px]">
          <div>
            <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">Har customer ko turant WhatsApp reply</h1>
            <p className="wa-muted mt-3 max-w-2xl">Customer ka message aate hi price list, brochure aur options chale jaate hain. Booking aur enquiry apne aap save hoti hai, aur aapki poori team ek hi number se chat sambhalti hai. MECGURA sab set up karke deta hai.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/demo" data-track="hi_demo_cta" className="wa-btn">Free demo book karein</Link>
              <a href={`https://wa.me/${siteConfig.contact.whatsapp}?text=${encodeURIComponent("Hi MECGURA, mujhe WhatsApp automation ke baare mein jaanna hai.")}`} data-track="hi_whatsapp_cta" className="wa-btn wa-btn-ghost">WhatsApp par baat karein</a>
            </div>
          </div>
          <ChatExample chat={[{ from: "customer", text: "Price list bhejo" }, { from: "business", text: "Namaste! 🙏 Ye rahi hamari price list aur brochure." }, { from: "business", text: "Price list · Call karo · Team se baat" }, { from: "customer", text: "Call karo" }, { from: "business", text: "Badhiya! Call kis naam se karein?" }]} />
        </div>
        <section className="mt-14">
          <h2 className="text-2xl font-bold">Aapko kya milega</h2>
          <ul className="mt-5 grid gap-4 md:grid-cols-2">
            {[["Turant reply", "Din ho ya raat, har message ka jawab seconds mein."], ["Price list aur brochure", "Image aur PDF ke saath, ek tap par."], ["Booking aur enquiry", "Naam, city, requirement sab apne aap save."], ["Team inbox", "Ek number, kai log. Kaun kya sambhal raha hai, sab dikhta hai."], ["Follow-up", "Jo customer chup ho gaya, use sahi time par yaad dilaana."], ["Offers", "Sirf unhi ko, jinhone permission di hai."]].map(([t, d]) => <li key={t} className="wa-card p-5"><p className="font-bold">{t}</p><p className="wa-muted mt-1 text-small">{d}</p></li>)}
          </ul>
        </section>
        <section className="mt-14"><h2 className="text-2xl font-bold">Kaise kaam karta hai</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5"><li>Aap hume apne business ke baare mein batate hain (15 minute ki call).</li><li>Hum replies, buttons, price list aur flows set up karte hain.</li><li>Aapka number connect hota hai aur sab live ho jaata hai.</li></ol>
          <p className="wa-muted mt-4 text-small">Apne business ke hisaab se dekhein: <Link href="/whatsapp-automation" className="text-[#128c7e] underline">salon, restaurant, resort, coaching, clinic, real estate, shop, gym</Link>. Kharche ka andaza: <Link href="/tools/whatsapp-message-cost-calculator" className="text-[#128c7e] underline">free calculator</Link>.</p>
        </section>
        <FaqList faqs={FAQS} title="Aam sawaal" />
        <LeadSection page={PATH} title="Free demo book karein" text="Apne business ke baare mein thoda batayein. Hum 15 minute mein dikhayenge ki aapke liye ye kaise kaam karega." />
      </div>
    </SeoFrame>
  );
}
