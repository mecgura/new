"use client";
import { Button, ErrorState } from "@/components/ui";

export default function AnalyticsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState title="Analytics couldn't load" description="This is on our side. Try again in a moment." action={<Button onClick={reset}>Try again</Button>} />;
}
