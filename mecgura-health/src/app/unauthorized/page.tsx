import type { Metadata } from "next";
import { ButtonLink, ErrorState } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in required" };

export default function Unauthorized() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-page">
      <ErrorState code="UNAUTHENTICATED" action={<ButtonLink href="/login">Sign in</ButtonLink>} />
    </main>
  );
}
