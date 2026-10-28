import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, MapPin } from "lucide-react";
import { publicJob } from "@/services/hiring/ats";
import { JOB_TYPE_LABELS } from "@/components/hiring/labels";
import { ApplyForm } from "@/components/hiring/apply-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string; jobSlug: string }> }): Promise<Metadata> {
  const { orgSlug, jobSlug } = await params;
  const d = await publicJob(orgSlug, jobSlug);
  return { title: d ? `${d.job.title} at ${d.org.name}` : "Job", robots: { index: true, follow: true } };
}

export default async function JobPage({ params }: { params: Promise<{ orgSlug: string; jobSlug: string }> }) {
  const { orgSlug, jobSlug } = await params;
  const d = await publicJob(orgSlug, jobSlug);
  if (!d) notFound();
  const j = d.job;
  return (
    <div className="wa-root min-h-dvh">
      <main id="main-content" className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1fr_22rem]">
        <article>
          <Link href={`/careers/${orgSlug}`} className="wa-muted inline-flex items-center gap-1 text-sm hover:underline"><ArrowLeft className="size-4" aria-hidden="true" /> All jobs at {d.org.name}</Link>
          <h1 className="mt-4 font-display text-4xl font-bold">{j.title}</h1>
          <p className="wa-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1"><Briefcase className="size-4" aria-hidden="true" /> {JOB_TYPE_LABELS[j.type] ?? j.type}{j.department ? ` · ${j.department}` : ""}</span>
            {j.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden="true" /> {j.location}</span> : null}
            {j.salary ? <span>{j.salary}</span> : null}
          </p>
          <div className="mt-6 whitespace-pre-wrap leading-7">{j.description || "Apply and we will share the details with you."}</div>
        </article>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <ApplyForm orgSlug={orgSlug} jobSlug={jobSlug} title={j.title} />
        </aside>
      </main>
    </div>
  );
}
