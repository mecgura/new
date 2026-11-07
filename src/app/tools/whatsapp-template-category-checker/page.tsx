import type { Metadata } from "next";
import { ToolPage } from "@/components/site/tool-page";
import { TemplateChecker } from "@/components/site/template-checker";
import { siteConfig } from "@/config/site";

const PATH = "/tools/whatsapp-template-category-checker";
const TITLE = "WhatsApp template checker: marketing or utility? (free)";
export const metadata: Metadata = {
  title: TITLE,
  description: "Paste a WhatsApp Business template and see whether it looks like marketing, utility or authentication, plus common reasons Meta rejects templates. Free, runs in your browser.",
  alternates: { canonical: PATH },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}${PATH}`, title: TITLE, description: "Check your WhatsApp template wording before you submit it.", siteName: "MECGURA" },
};

export default function Page() {
  return (
    <ToolPage
      path={PATH}
      title="WhatsApp template category checker"
      h1="WhatsApp template checker: marketing or utility?"
      intro="Paste your template text. We point out whether it reads like marketing, utility or an OTP message, and flag the mistakes that often get templates rejected. It is a guide; Meta makes the final decision."
      steps={["Paste your template text. Use {{1}}, {{2}} where the details change.", "Read the likely category and the reasons.", "Fix the warnings (variables at the start or end, shortened links, too long).", "Submit it through your provider for Meta's approval."]}
      faqs={[
        { q: "Is this Meta's official check?", a: "No. It is a rule-based guide that looks at the wording. Meta decides the real category by looking at what the message is for." },
        { q: "Can I make a promotion pass as utility?", a: "No, and you should not try. Meta re-categorises promotions as marketing, and repeated misuse can restrict your number. If your message has an offer, treat it as marketing and send it only to opted-in customers." },
        { q: "Why was my template rejected?", a: "Common reasons are variables at the start or end, variables with too little text around them, link shorteners, risky claims, and a category that does not match the content." },
        { q: "Is my text stored?", a: "No. The check runs in your browser." },
      ]}
    >
      <TemplateChecker whatsapp={siteConfig.contact.whatsapp} />
    </ToolPage>
  );
}
