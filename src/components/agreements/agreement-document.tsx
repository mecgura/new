import { formatINR } from "@/lib/catalog";

export type Section = { heading: string; body: string[] };
export type Details = {
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
export type ProviderView = { legalName: string; address: string; gstin: string; email: string; phone: string; signatoryName: string; signatoryTitle: string };

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex gap-2 py-1 text-small">
    <dt className="w-32 shrink-0 text-app-muted print:text-black/60">{k}</dt>
    <dd className="min-w-0 break-words font-medium text-app-text print:text-black">{v || "—"}</dd>
  </div>
);

/** The agreement as a printable document: summary table and clauses (or the frozen signed text). */
export function AgreementDocument({ details: d, sections, signedText, provider, signed }: { details: Details; sections: Section[] | null; signedText?: string; provider: ProviderView; signed?: { name: string; at: string; hash: string } | null }) {
  const address = [d.address, d.city, d.state, d.pincode].filter((x) => x.trim()).join(", ");
  return (
    <article className="agreement-doc rounded-2xl border border-app-border bg-app-surface p-5 sm:p-8 print:border-0 print:bg-white print:p-0 print:text-black">
      <header className="border-b border-app-border pb-4 print:border-black/20">
        <p className="text-caption font-semibold uppercase tracking-wider text-app-primary print:text-black">Service agreement</p>
        <h2 className="mt-1 font-display text-2xl font-bold text-app-text print:text-black">{provider.legalName || "MECGURA"} × {d.businessName || "Client"}</h2>
        <p className="mt-1 text-small text-app-muted print:text-black/70">
          {d.number} · version {d.version}
        </p>
      </header>
      <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
        <Row k="Business" v={`${d.businessName}${d.businessType ? ` (${d.businessType})` : ""}`} />
        <Row k="Contact person" v={`${d.contactName}${d.designation ? `, ${d.designation}` : ""}`} />
        <Row k="Mobile" v={d.phone} />
        <Row k="Email" v={d.email} />
        <Row k="Address" v={address} />
        <Row k="GSTIN / PAN" v={[d.gstin, d.pan].filter(Boolean).join(" / ")} />
        <Row k="Plan" v={d.planName} />
        <Row k="Fee" v={`${d.pricePaise ? `${formatINR(d.pricePaise)}/month + GST` : ""}${d.setupFeePaise ? ` · setup ${formatINR(d.setupFeePaise)}` : ""}`} />
        <Row k="Services" v={d.services.join(", ")} />
        <Row k="Meta charges" v={d.billingMode === "prepaid_wallet" ? "Paid from MECGURA prepaid wallet" : d.billingMode === "package" ? "Included in the MECGURA package" : "Paid by the client directly to Meta"} />
      </dl>
      <div className="mt-6 space-y-5">
        {sections
          ? sections.map((s) => (
              <section key={s.heading} className="break-inside-avoid">
                <h3 className="font-semibold text-app-text print:text-black">{s.heading}</h3>
                {s.body.map((p, i) => (
                  <p key={i} className="mt-1.5 text-small leading-6 text-app-muted print:text-black/80">
                    {p}
                  </p>
                ))}
              </section>
            ))
          : <pre className="whitespace-pre-wrap font-sans text-small leading-6 text-app-muted print:text-black/80">{signedText}</pre>}
      </div>
      <footer className="mt-8 grid gap-6 border-t border-app-border pt-5 text-small sm:grid-cols-2 print:border-black/20">
        <div>
          <p className="text-app-muted print:text-black/60">For {provider.legalName || "MECGURA"}</p>
          <p className="mt-1 font-semibold text-app-text print:text-black">{provider.signatoryName || "Authorised signatory"}</p>
          <p className="text-app-muted print:text-black/60">{provider.signatoryTitle}</p>
        </div>
        <div>
          <p className="text-app-muted print:text-black/60">For {d.businessName || "the Client"}</p>
          {signed ? (
            <>
              <p className="mt-1 font-semibold text-app-text print:text-black">{signed.name} (accepted electronically)</p>
              <p className="text-app-muted print:text-black/60">{new Date(signed.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
              <p className="mt-1 break-all font-mono text-[10px] text-app-subtle print:text-black/50">SHA-256 {signed.hash}</p>
            </>
          ) : (
            <p className="mt-1 text-app-subtle">Not signed yet</p>
          )}
        </div>
      </footer>
    </article>
  );
}
