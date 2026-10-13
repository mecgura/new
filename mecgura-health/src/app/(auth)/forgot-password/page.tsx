import type { Metadata } from "next";
import { ForgotForm } from "@/components/security/auth-forms";

export const metadata: Metadata = { title: "Reset password" };
export default function Page() {
  return (<main id="main" className="flex min-h-dvh items-center justify-center px-page py-10"><div className="w-full max-w-sm"><h1 className="type-page-title">Reset your password</h1><p className="type-secondary mb-6 mt-1">Enter your account email. If it matches an account, we send a one-time link.</p><ForgotForm /></div></main>);
}
