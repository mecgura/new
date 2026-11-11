import { ButtonLink, ErrorState } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-page">
      <ErrorState code="NOT_FOUND" title="Page not found" description="The page you're looking for doesn't exist or has moved." action={<ButtonLink href="/dashboard">Go to dashboard</ButtonLink>} />
    </main>
  );
}
