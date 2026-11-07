import type { Metadata } from "next";
import { ToolPage } from "@/components/site/tool-page";
import { OptInGenerator } from "@/components/site/optin-generator";
import { siteConfig } from "@/config/site";

const PATH = "/tools/whatsapp-opt-in-message-generator";
const TITLE = "WhatsApp opt-in message generator (English and Hinglish)";
export const metadata: Metadata = {
  title: TITLE,
  description: "Create the wording to ask customers for WhatsApp permission: the ask, a form checkbox, the confirmation reply and a STOP line. Free, English or Hinglish.",
  alternates: { canonical: PATH },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}${PATH}`, title: TITLE, description: "Ready-to-use WhatsApp opt-in text for your shop, QR code, website or ad chat.", siteName: "MECGURA" },
};

export default function Page() {
  return (
    <ToolPage
      path={PATH}
      title="WhatsApp opt-in message generator"
      h1="WhatsApp opt-in message generator"
      intro="Before you send offers on WhatsApp, customers must agree to receive them. Fill in your business details and get clear wording for the ask, your form checkbox, the confirmation and the STOP line."
      steps={["Enter your business name and where you will ask for permission.", "Choose what you will send and how often.", "Copy the texts and use them at your counter, on your QR poster, form or chat.", "Keep a record of when and how each customer agreed."]}
      faqs={[
        { q: "What is an opt-in?", a: "It is the customer's clear permission to receive your WhatsApp messages. It should say who you are, what you will send and how to stop." },
        { q: "Do I need an opt-in for order updates?", a: "Messages about something the customer just did, like an order, are different from marketing, but clear permission is still the safest practice and protects your number." },
        { q: "Can I add numbers from my phone contacts?", a: "Not for marketing. Having someone's number is not permission. Ask them first." },
        { q: "How do I handle STOP?", a: "Stop marketing to anyone who replies STOP, straight away, and keep that record." },
      ]}
    >
      <OptInGenerator whatsapp={siteConfig.contact.whatsapp} />
    </ToolPage>
  );
}
