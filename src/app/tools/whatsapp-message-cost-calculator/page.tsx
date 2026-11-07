import type { Metadata } from "next";
import { ToolPage } from "@/components/site/tool-page";
import { CostCalculator } from "@/components/site/cost-calculator";
import { getMetaRates } from "@/services/meta-rates";
import { siteConfig } from "@/config/site";

export const revalidate = 3600;

const PATH = "/tools/whatsapp-message-cost-calculator";
const TITLE = "WhatsApp Business message cost calculator for India";
export const metadata: Metadata = {
  title: TITLE,
  description: "Estimate Meta’s monthly WhatsApp Business API charges in rupees: marketing, utility and OTP messages. Free calculator, no sign-up.",
  alternates: { canonical: PATH },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}${PATH}`, title: TITLE, description: "How much will WhatsApp messages cost per month? Estimate it in seconds.", siteName: "MECGURA" },
};

export default async function Page() {
  const rates = await getMetaRates();
  return (
    <ToolPage
      path={PATH}
      title="WhatsApp message cost calculator"
      h1="WhatsApp Business message cost calculator (India)"
      intro="Meta charges per template message sent on the WhatsApp Business Platform. Enter how many messages you plan to send each month and see the estimated charge in rupees."
      steps={["Enter how many marketing messages (offers and promotions) you plan to send each month.", "Enter utility messages (order, booking, payment and delivery updates), and how many of them go within 24 hours of the customer’s last message, because those are free.", "Add OTP / authentication messages if you send any.", "Read the estimate. Meta bills you directly, separate from any platform plan."]}
      faqs={[
        { q: "Which WhatsApp messages are free?", a: "When a customer messages you first, you can reply freely for 24 hours. Utility templates sent inside that 24-hour window are also free. Marketing templates are always charged." },
        { q: "Why is marketing so much more expensive than utility?", a: "Meta prices by category. Marketing (promotions and offers) costs several times more than utility (updates about something the customer already did). Use each category for what it is meant for." },
        { q: "Can I send my offers as utility to save money?", a: "No. Meta checks content, re-categorises promotions as marketing, and can restrict numbers that misuse categories. Save money legitimately: send updates as utility, and use replies and 24-hour windows well." },
        { q: "Does this include GST?", a: "No. It is a before-tax estimate. Taxes are added as applicable on your invoice." },
        { q: "Who do I pay?", a: "Meta bills your WhatsApp Business account directly. A platform like MECGURA charges a separate monthly plan for the software." },
        { q: "How current are the rates?", a: "They are Meta’s India rates as maintained by MECGURA. Meta can change them, so check Meta’s official pricing page before you commit." },
      ]}
    >
      <CostCalculator rates={rates} whatsapp={siteConfig.contact.whatsapp} />
    </ToolPage>
  );
}
