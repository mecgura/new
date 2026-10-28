import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/layout/logo";
import { ToastProvider } from "@/components/ds";
import { AgreementSigner } from "@/components/agreements/agreement-signer";
import { publicAgreement, type PublicAgreement } from "@/services/agreements/agreements";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Service agreement", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The client's agreement link: check details, upload business proof, accept. No login; the token is the key. */
export default async function AgreementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let a: PublicAgreement;
  try {
    a = await publicAgreement(token);
  } catch {
    notFound();
  }
  return (
    <ToastProvider>
      <div className="app-root dark min-h-dvh px-4 py-8 print:bg-white print:p-0">
        <main id="main-content" className="mx-auto w-full max-w-3xl">
          <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
            <Logo tone="dark" />
            <span className="text-caption text-app-muted">{a.number}</span>
          </div>
          <AgreementSigner token={token} initial={JSON.parse(JSON.stringify(a))} />
        </main>
      </div>
    </ToastProvider>
  );
}
