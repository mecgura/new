import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { LegalContact } from "@/components/legal-contact";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${siteConfig.product} handles personal data.`,
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="opacity-70">Last updated: 18 October 2026</p>
      <p>
        {siteConfig.product} (“we”, “us”) is a WhatsApp business messaging platform operated by MECGURA. Businesses that use it (“clients”) manage their customer
        conversations, contacts, campaigns and automations in a private workspace. This policy explains what data we handle and why.
      </p>

      <h2>Who is responsible for which data</h2>
      <ul>
        <li>
          <strong>Account data</strong> (name, email, sign-in details of our clients’ team members): we are the controller.
        </li>
        <li>
          <strong>Customer data</strong> (contacts, phone numbers, messages, and tags a client stores or exchanges through the platform): the client is the
          controller and we process it on the client’s behalf and on their instructions. If you are a client’s customer and want to see or delete your data,
          please contact that business first.
        </li>
      </ul>

      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, email, hashed password, role, sign-in and security events.</li>
        <li>Workspace data entered by clients: contacts, conversations and messages, templates, campaigns, automations, notes and files.</li>
        <li>WhatsApp Business connection details (account and phone-number identifiers). Access tokens are stored encrypted and are never shown back.</li>
        <li>Billing details: plan, invoices and payment status. Card or bank details are handled by the payment provider, not stored by us.</li>
        <li>Technical data: IP address, browser, and request logs used for security, rate limiting and troubleshooting.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To provide the service: send and receive WhatsApp messages, run campaigns and automations, show analytics.</li>
        <li>To secure accounts, prevent abuse and keep audit logs.</li>
        <li>To bill clients and provide support.</li>
        <li>To comply with legal obligations and WhatsApp/Meta platform rules (for example opt-in, opt-out and template policies).</li>
      </ul>

      <h2>Service providers we rely on</h2>
      <p>We share data only as needed to run the service, with providers such as:</p>
      <ul>
        <li>Meta Platforms (WhatsApp Business Platform), to deliver messages.</li>
        <li>Our hosting and database providers (Vercel and Neon), to run the application and store data.</li>
        <li>An email provider, for password-reset and account emails, when configured.</li>
        <li>A payment provider, for billing, when configured.</li>
        <li>An AI provider, only when a client turns on AI replies. The relevant conversation text is sent to generate a reply.</li>
      </ul>
      <p>We do not sell personal data.</p>

      <h2>Retention</h2>
      <p>
        Workspace data is kept while the client’s account is active. When a workspace is closed, its data is deleted or anonymised within a reasonable period,
        except records we must keep for legal, tax or security reasons.
      </p>

      <h2>Security</h2>
      <p>
        Passwords are hashed, WhatsApp credentials are encrypted at rest, access is separated per workspace, and sensitive actions are audit-logged. No system is
        perfectly secure; if we learn of a breach affecting you we will notify the affected clients.
      </p>

      <h2>Your choices and rights</h2>
      <p>
        You can ask to access, correct or delete your data, or object to processing. See <a href="/data-deletion">how to request deletion</a>, or contact{" "}
        <LegalContact />.
      </p>

      <h2>Changes</h2>
      <p>We may update this policy. The date above shows the latest version.</p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <LegalContact />.
      </p>
    </>
  );
}
