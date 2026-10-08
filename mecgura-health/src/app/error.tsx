"use client";
import { useEffect } from "react";
import { Button, ErrorState } from "@/components/ui";

// Route-level error boundary. Shows friendly copy only; `error.digest` is the id support can match to server logs.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Route error", error.digest ?? "");
  }, [error]);
  return (
    <main id="main" className="flex min-h-[60dvh] items-center justify-center p-page">
      <ErrorState action={<div className="flex flex-col items-center gap-2"><Button onClick={reset}>Try again</Button>{error.digest && <p className="type-caption">Reference: {error.digest}</p>}</div>} />
    </main>
  );
}
