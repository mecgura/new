import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { LegalContact } from "@/components/legal-contact";

export const metadata: Metadata = {
  title: "Data deletion",
  description: `How to request deletion of your data from ${siteConfig.product}.`,
  robots: { index: true, follow: true },
};

export default function DataDeletionPage() {
  return (
    <>
      <h1>Data deletion</h1>
      <p className="opacity-70">Last updated: 18 October 2026</p>

      <h2>If you are a customer of a business that uses {siteConfig.product}</h2>
      <p>
        That business decides what happens to the messages and contact details it holds. Ask the business to delete your data, or reply <strong>STOP</strong> to
        any of its WhatsApp messages to stop further messages. You can also contact us at <LegalContact /> and we will pass your request to the business.
      </p>

      <h2>If you are a workspace user or client</h2>
      <p>
        Contact <LegalContact /> from the email address on your account and tell us whether you want your user account or your whole workspace deleted. We will
        confirm your identity, then delete the data (or anonymise what we must legally retain) and confirm when it is done.
      </p>

      <h2>What is deleted</h2>
      <ul>
        <li>Account profile and sign-in data.</li>
        <li>Contacts, conversations, messages, templates, campaigns, automations and uploaded files in the workspace.</li>
        <li>Stored WhatsApp credentials. You should also remove our access from your Meta Business settings.</li>
      </ul>
      <p>Invoices and security logs may be kept for the period required by law.</p>
    </>
  );
}
