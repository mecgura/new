import type { Metadata } from "next";
import { ToolPage } from "@/components/site/tool-page";
import { WaLinkTool } from "@/components/site/wa-link-tool";
import { siteConfig } from "@/config/site";

const PATH = "/tools/whatsapp-link-generator";
const TITLE = "Free WhatsApp link generator (wa.me link with message)";
export const metadata: Metadata = {
  title: TITLE,
  description: "Create a click-to-chat WhatsApp link with a pre-filled message in seconds. Works with WhatsApp and WhatsApp Business. Free, no sign-up, runs in your browser.",
  alternates: { canonical: PATH },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}${PATH}`, title: TITLE, description: "Make a wa.me link with a ready message and a QR code. Free.", siteName: "MECGURA" },
};

export default function Page() {
  return (
    <ToolPage
      path={PATH}
      title="WhatsApp link generator"
      h1="Free WhatsApp link generator"
      intro="Type your number and a first message. Get a link that opens a WhatsApp chat with you in one tap. Use it on Instagram, Facebook, Google Business, your website, SMS or email."
      steps={["Enter your WhatsApp number (10-digit Indian numbers get +91 automatically).", "Write the message customers will send first, for example “Hi, I want the price list”.", "Copy the link, or download the QR code, and paste it where customers will see it.", "Tap “Test it” to check it opens the right chat."]}
      faqs={[
        { q: "What is a wa.me link?", a: "A wa.me link is a click-to-chat link. When someone taps it, WhatsApp opens a chat with your number, with your message already typed in. They only press send." },
        { q: "Does it work with WhatsApp Business?", a: "Yes. The same link works for the normal WhatsApp app, WhatsApp Business app and the WhatsApp Business Platform." },
        { q: "Do I need to add the country code?", a: "WhatsApp needs it. This tool adds +91 to 10-digit Indian mobile numbers. For other countries type the full number with the country code." },
        { q: "Is it free and private?", a: "Yes. It is free and runs in your browser. Your number and message are not sent to our servers." },
        { q: "Can I reply to everyone automatically?", a: "The link only opens the chat. To send an instant reply with your price list, brochure and buttons, you need WhatsApp automation. MECGURA sets that up on the same number." },
      ]}
    >
      <WaLinkTool mode="link" whatsapp={siteConfig.contact.whatsapp} />
    </ToolPage>
  );
}
