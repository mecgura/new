import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ds";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
