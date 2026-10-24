import { createHash } from "node:crypto";
import { formatINR } from "@/lib/catalog";

/**
 * The MECGURA service agreement, written for Indian law and plain enough for a shop owner to read. The text is
 * built from the agreement's details, so a corrected phone number or GSTIN shows up in the contract itself.
 * When the client accepts, the exact text is frozen on the record along with its SHA-256 hash.
 */
export type Provider = {
  legalName: string;
  address: string;
  gstin: string;
  email: string;
  phone: string;
  signatoryName: string;
  signatoryTitle: string;
  jurisdiction: string;
};

export type AgreementDetails = {
  number: string;
  version: number;
  businessName: string;
  businessType: string;
  contactName: string;
  designation: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
  pan: string;
  planName: string;
  pricePaise: number;
  setupFeePaise: number;
  services: string[];
  billingMode: string;
  startDate: string;
  termMonths: number;
  extraTerms: string;
};

export type Section = { heading: string; body: string[] };

const or = (v: string, fallback: string) => (v.trim() ? v.trim() : fallback);
const dateText = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "the date this agreement is accepted";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
};

export function clientAddress(d: Pick<AgreementDetails, "address" | "city" | "state" | "pincode">) {
  return [d.address, d.city, d.state, d.pincode].map((x) => x.trim()).filter(Boolean).join(", ");
}

export function agreementSections(d: AgreementDetails, p: Provider): Section[] {
  const provider = or(p.legalName, "MECGURA");
  const client = or(d.businessName, "the Client");
  const court = or(p.jurisdiction, "the city where MECGURA's office is registered");
  const services = d.services.length ? d.services : ["WhatsApp Business automation"];
  const fee = d.pricePaise > 0 ? `${formatINR(d.pricePaise)} per month` : "the amount shown on MECGURA's invoice";
  const prepaid = d.billingMode === "prepaid_wallet";

  const sections: Section[] = [
    {
      heading: "1. Parties",
      body: [
        `This Service Agreement is between ${provider}${p.address.trim() ? `, ${p.address.trim()}` : ""}${p.gstin.trim() ? ` (GSTIN ${p.gstin.trim()})` : ""} ("MECGURA"), and ${client}${clientAddress(d) ? `, ${clientAddress(d)}` : ""}${d.gstin.trim() ? ` (GSTIN ${d.gstin.trim()})` : ""}${d.pan.trim() ? ` (PAN ${d.pan.trim()})` : ""} ("the Client"), represented by ${or(d.contactName, "its authorised person")}${d.designation.trim() ? `, ${d.designation.trim()}` : ""}.`,
      ],
    },
    {
      heading: "2. Services",
      body: [
        `MECGURA will provide the Client access to the MECGURA platform${d.planName.trim() ? ` on the ${d.planName.trim()} plan` : ""} and the following services: ${services.join(", ")}.`,
        "MECGURA will set up the services, connect the Client's WhatsApp Business number through Meta's official WhatsApp Business Platform, and give support on working days (10 am to 7 pm IST) over WhatsApp, phone or email.",
        "Plan limits (users, numbers, messages) are as shown in the Client's MECGURA dashboard. Extra services are added only with the Client's written or electronic approval.",
      ],
    },
    {
      heading: "3. Term",
      body: [
        `This agreement starts on ${dateText(d.startDate)} and runs for ${d.termMonths} month${d.termMonths === 1 ? "" : "s"}. After that it renews month to month until either party ends it under clause 11.`,
      ],
    },
    {
      heading: "4. Fees and payment",
      body: [
        `The service fee is ${fee}${d.setupFeePaise > 0 ? `, plus a one-time setup fee of ${formatINR(d.setupFeePaise)}` : ""}. GST is charged extra at the applicable rate.`,
        "Fees are payable in advance, within 7 days of the invoice date, by UPI, bank transfer or the online payment link. Fees already paid for a running period are not refundable.",
        "If payment is more than 7 days late, MECGURA may pause the services after giving notice on WhatsApp or email. Services restart once the dues are cleared.",
      ],
    },
    {
      heading: "5. WhatsApp (Meta) message charges",
      body: prepaid
        ? [
            "Meta charges for WhatsApp template messages are paid by MECGURA and recovered from the Client's prepaid MECGURA wallet. Each message is deducted at the rate shown in the Client's wallet, which includes Meta's charge and MECGURA's handling fee.",
            "The Client keeps enough balance in the wallet. When the balance is too low, messages are paused until the wallet is recharged. If Meta changes its rates, the wallet rates change from the next message and the new rates are shown in the dashboard. Unused balance is refunded on termination, after settling dues.",
          ]
        : [
            "Meta's charges for WhatsApp messages are billed by Meta directly to the payment method the Client adds to its own WhatsApp Business account. These charges are not part of MECGURA's fee.",
            "If Meta stops sending messages because of an unpaid Meta bill or a missing payment method, MECGURA is not responsible for the messages not sent.",
          ],
    },
    {
      heading: "6. The Client's responsibilities",
      body: [
        "Message only people who have agreed to receive WhatsApp messages from the Client, and stop messaging anyone who asks to stop.",
        "Follow Meta's WhatsApp Business Messaging Policy, Commerce Policy and Terms, and all Indian laws, including the Information Technology Act, 2000, the Consumer Protection Act, 2019 and the Digital Personal Data Protection Act, 2023.",
        "Not send spam, false, misleading, obscene, hateful or illegal content, or promote anything Meta does not allow.",
        "Keep its logins and passwords safe. Everything done from the Client's account is treated as done by the Client.",
        "Give correct business details and documents, and tell MECGURA when they change.",
      ],
    },
    {
      heading: "7. What MECGURA does not control",
      body: [
        "WhatsApp is run by Meta. Meta decides template approvals, number quality ratings, messaging limits, verification and bans. MECGURA will help the Client follow Meta's rules but cannot guarantee any Meta decision or that every message is delivered.",
        "MECGURA aims to keep the platform available at all times but does not promise uninterrupted service. Planned maintenance is announced in advance where possible.",
      ],
    },
    {
      heading: "8. Data protection and confidentiality",
      body: [
        "The Client owns its customer data and decides how it is used (Data Fiduciary). MECGURA processes it only to provide the services and on the Client's instructions (Data Processor), with reasonable security safeguards as required by the Digital Personal Data Protection Act, 2023.",
        "MECGURA does not sell the Client's data. Both parties keep each other's business information confidential, during this agreement and after it ends.",
        "On termination the Client can export its contacts and chats. MECGURA deletes the Client's data within 30 days of a written request, except what the law requires it to keep.",
      ],
    },
    {
      heading: "9. Ownership",
      body: [
        "The MECGURA platform, software, ready-made automations and designs belong to MECGURA. The Client gets the right to use them while this agreement is active.",
        "The Client's own content, logo, contacts and messages belong to the Client.",
      ],
    },
    {
      heading: "10. Limitation of liability",
      body: [
        "MECGURA's total liability under this agreement is limited to the fees the Client paid MECGURA in the 3 months before the claim. Neither party is liable for indirect losses such as loss of profit, business or data, or for delays caused by events outside its control (including Meta outages, internet failures or government action).",
        "The Client is responsible for the content it sends and for any claim caused by its breach of Meta's policies or the law.",
      ],
    },
    {
      heading: "11. Suspension and termination",
      body: [
        "Either party may end this agreement with 30 days' notice on WhatsApp or email.",
        "MECGURA may suspend or end the services immediately if the Client breaks Meta's policies or the law, gives false documents, or does not pay after notice.",
        "Fees due up to the end date remain payable.",
      ],
    },
    {
      heading: "12. Business proof (KYC)",
      body: [
        "The Client confirms that the business documents it uploads (such as GST certificate, Udyam registration, PAN or shop licence) are genuine and belong to the Client's business. MECGURA uses them only to verify the business and for Meta business verification.",
      ],
    },
    {
      heading: "13. Disputes, law and jurisdiction",
      body: [
        "The parties will first try to settle any dispute by talking in good faith for 30 days.",
        `This agreement is governed by the laws of India. The courts at ${court} have exclusive jurisdiction.`,
      ],
    },
    {
      heading: "14. Electronic acceptance",
      body: [
        "This agreement is accepted electronically. Typing a name and ticking the consent box is the Client's signature and is valid and binding under the Information Technology Act, 2000 and the Indian Contract Act, 1872. MECGURA keeps a record of the time, IP address, device and a fingerprint (SHA-256 hash) of the accepted text.",
        "Any change to this agreement is made by a new version that the Client accepts in the same way.",
      ],
    },
  ];
  if (d.extraTerms.trim()) sections.push({ heading: "15. Additional terms", body: d.extraTerms.trim().split(/\n{2,}/).map((x) => x.trim()).filter(Boolean) });
  sections.push({ heading: `${d.extraTerms.trim() ? 16 : 15}. Entire agreement`, body: ["This agreement, with MECGURA's invoices and the plan details in the dashboard, is the entire agreement between the parties about the services."] });
  return sections;
}

/** Plain-text copy of the whole agreement (what gets frozen and hashed at signing, and emailed). */
export function agreementText(d: AgreementDetails, p: Provider): string {
  const head = [
    `MECGURA SERVICE AGREEMENT  ${d.number} (version ${d.version})`,
    "",
    `Client: ${d.businessName}${d.businessType ? ` (${d.businessType})` : ""}`,
    `Contact: ${d.contactName}${d.designation ? `, ${d.designation}` : ""}  |  ${d.phone}  |  ${d.email}`,
    `Address: ${clientAddress(d) || "-"}`,
    `GSTIN: ${d.gstin || "-"}  |  PAN: ${d.pan || "-"}`,
    `Plan: ${d.planName || "-"}  |  Fee: ${d.pricePaise ? formatINR(d.pricePaise) + "/month" : "-"}${d.setupFeePaise ? `  |  Setup: ${formatINR(d.setupFeePaise)}` : ""}`,
    "",
  ];
  const body = agreementSections(d, p).flatMap((s) => [s.heading, ...s.body, ""]);
  return [...head, ...body].join("\n").trim();
}

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
