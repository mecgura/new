import type { Metadata } from "next";
import { ToolPage } from "@/components/site/tool-page";
import { WaLinkTool } from "@/components/site/wa-link-tool";
import { siteConfig } from "@/config/site";

const PATH = "/tools/whatsapp-qr-code-generator";
const TITLE = "Free WhatsApp QR code generator (download PNG)";
export const metadata: Metadata = {
  title: TITLE,
  description: "Make a WhatsApp QR code that opens your chat with a ready message. Download a print-ready PNG for shop boards, menus and visiting cards. Free, no sign-up.",
  alternates: { canonical: PATH },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}${PATH}`, title: TITLE, description: "Print-ready WhatsApp QR code in a few seconds. Free.", siteName: "MECGURA" },
};

export default function Page() {
  return (
    <ToolPage
      path={PATH}
      title="WhatsApp QR code generator"
      h1="Free WhatsApp QR code generator"
      intro="Make a QR code that opens a WhatsApp chat with your business when customers scan it with their phone camera. Download it as a high-resolution PNG and print it."
      steps={["Enter your WhatsApp number and the first message customers should send.", "Pick a colour. Dark colours scan best on white paper.", "Download the PNG (1024×1024).", "Scan it with your own phone before you print, then put it on your shop board, menu, bill, packaging or visiting card."]}
      faqs={[
        { q: "Where can I use a WhatsApp QR code?", a: "Shop boards and windows, menus, bills and packaging, visiting cards, pamphlets, newspaper ads, posters and event stalls. Anywhere a customer can point a phone." },
        { q: "Will the QR code expire?", a: "No. It contains your WhatsApp link itself, so it keeps working as long as the number is active. If you change the number, make a new code." },
        { q: "What size should I print?", a: "The PNG is 1024×1024 pixels, which is sharp for prints up to about 10 cm. Keep a clear white border around it and don’t stretch it." },
        { q: "Is my number sent to your server?", a: "No. The code is created in your browser." },
        { q: "Can the chat be answered automatically?", a: "Yes, with WhatsApp automation. Customers who scan can get your price list, brochure and booking buttons instantly. MECGURA can set this up for you." },
      ]}
    >
      <WaLinkTool mode="qr" whatsapp={siteConfig.contact.whatsapp} />
    </ToolPage>
  );
}
