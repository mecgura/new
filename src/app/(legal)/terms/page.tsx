import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { LegalContact } from "@/components/legal-contact";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `Terms for using ${siteConfig.product}.`,
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="opacity-70">Last updated: 18 October 2026</p>
      <p>
        These terms govern use of {siteConfig.product}, operated by MECGURA. By signing in or using the service you agree to them. If you use it for a business,
        you confirm you are authorised to bind that business.
      </p>

      <h2>The service</h2>
      <p>
        {siteConfig.product} provides tools to manage WhatsApp conversations, contacts, campaigns, automations, and related reporting. Some features need
        third-party accounts (for example a Meta WhatsApp Business account) that you set up and remain responsible for. Features shown as “demo” do not send real
        messages.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your password confidential and tell us promptly if you suspect misuse.</li>
        <li>You are responsible for activity under your workspace, including by your team members.</li>
        <li>Accounts are created by an administrator; we may suspend an account that is abused or unpaid.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>You must follow the WhatsApp Business Terms, WhatsApp Business Messaging Policy and Commerce Policy, and applicable law. In particular you must not:</p>
      <ul>
        <li>message people who have not agreed to receive your messages, or ignore opt-out requests;</li>
        <li>send spam, deceptive, illegal or prohibited-category content;</li>
        <li>upload contacts you have no right to contact;</li>
        <li>attempt to break, overload or reverse-engineer the service, or access another workspace’s data.</li>
      </ul>
      <p>Meta may restrict or ban a WhatsApp number for policy violations. We are not responsible for restrictions applied by Meta.</p>

      <h2>Fees</h2>
      <p>
        Plans, prices and billing cycles are agreed with you when your workspace is set up. WhatsApp conversation and message charges made by Meta are separate
        from our fees and are billed by Meta to the WhatsApp Business account holder unless agreed otherwise in writing.
      </p>

      <h2>Your data</h2>
      <p>
        You keep ownership of the data you put into the service. You give us permission to process it only to provide the service. See the{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Availability and liability</h2>
      <p>
        We work to keep the service reliable but do not guarantee uninterrupted operation, and the service depends on third parties such as Meta. To the extent
        allowed by law, we are not liable for indirect or consequential loss, and our total liability is limited to the fees you paid for the service in the three
        months before the claim.
      </p>

      <h2>Ending the service</h2>
      <p>You may stop using the service at any time. We may suspend or end access for breach of these terms. On closure your data is handled as described in the Privacy Policy.</p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; continued use after an update means you accept it. Questions: <LegalContact />.
      </p>
    </>
  );
}
