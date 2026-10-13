import type { Metadata } from "next";
import { ResetForm } from "@/components/security/auth-forms";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (<main id="main" className="flex min-h-dvh items-center justify-center px-page py-10"><div className="w-full max-w-sm"><h1 className="type-page-title">Choose a new password</h1><p className="type-secondary mb-6 mt-1">This link works once. All your other sessions will be signed out.</p><ResetForm token={token} /></div></main>);
}
