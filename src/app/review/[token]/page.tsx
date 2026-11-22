import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { EmptyState } from "@/components/ds";
import { ReviewClient } from "@/components/onepost/review-client";
import { getReviewView } from "@/services/onepost/review-link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review a post", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The private page a client opens from the link they were sent. No login; the long random link is the key. */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const view = await getReviewView((await params).token);
  return (
    <div className="app-root dark min-h-dvh px-4 py-8">
      <main id="main-content" className="mx-auto w-full max-w-7xl">
        <div className="mb-8">
          <Logo tone="dark" />
        </div>
        {view.state === "ok" ? (
          <ReviewClient token={(await params).token} view={{ business: view.business, website: view.website, title: view.title, expiresAt: view.expiresAt.toISOString(), versions: view.versions, media: view.media }} />
        ) : (
          <div className="mx-auto max-w-xl pt-10">
            <EmptyState icon={Lock} title="This link can't be used" description={view.message} />
          </div>
        )}
      </main>
    </div>
  );
}
