import type { Metadata } from "next";
import { ButtonLink, ErrorState } from "@/components/ui";

export const metadata: Metadata = { title: "No access" };

export default function Forbidden() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-page">
      <ErrorState code="FORBIDDEN" action={<ButtonLink href="/dashboard">Back to dashboard</ButtonLink>} />
    </main>
  );
}
