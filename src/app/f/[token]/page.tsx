import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { openFeedback } from "@/services/reviews/reviews";
import { FeedbackForm } from "./feedback-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your feedback", robots: { index: false, follow: false } };

/** Public feedback page a customer opens from their WhatsApp link. */
export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = await openFeedback(token.slice(0, 40));
  if (!f) notFound();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f6f1e7] px-4 py-10 text-[#10231a]">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_20px_50px_-20px_rgba(16,35,26,0.35)] sm:p-8">
        <p className="text-sm font-medium text-emerald-700">{f.business}</p>
        <FeedbackForm token={token} firstName={f.firstName} business={f.business} alreadyRated={f.rated} hasReviewLink={Boolean(f.reviewUrl)} />
      </div>
    </main>
  );
}
