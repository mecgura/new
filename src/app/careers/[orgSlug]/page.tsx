import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, MapPin } from "lucide-react";
import { publicJobs } from "@/services/hiring/ats";
import { JOB_TYPE_LABELS } from "@/components/hiring/labels";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const d = await publicJobs((await params).orgSlug);
  return { title: d ? `Careers at ${d.org.name}` : "Careers", robots: { index: true, follow: true } };
}

/** Public careers page for a workspace: every open job, with a link to apply. */
export default async function CareersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const d = await publicJobs(orgSlug);
  if (!d) notFound();
  return (
    <div className="wa-root min-h-dvh">
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-12">
        <p className="wa-pill">We&apos;re hiring</p>
        <h1 className="mt-3 font-display text-4xl font-bold">Careers at {d.org.name}</h1>
        <p className="wa-muted mt-2">{d.jobs.length ? `${d.jobs.length} open position${d.jobs.length === 1 ? "" : "s"}. Apply in 2 minutes, no account needed.` : "No open positions right now. Please check again soon."}</p>
        <ul className="mt-8 space-y-3">
          {d.jobs.map((j) => (
            <li key={j.slug}>
              <Link href={`/careers/${orgSlug}/${j.slug}`} className="wa-card block p-5 transition hover:shadow-md">
                <h2 className="text-lg font-bold">{j.title}</h2>
                <p className="wa-muted mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="inline-flex items-center gap-1"><Briefcase className="size-4" aria-hidden="true" /> {JOB_TYPE_LABELS[j.type] ?? j.type}{j.department ? ` · ${j.department}` : ""}</span>
                  {j.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden="true" /> {j.location}</span> : null}
                  {j.salary ? <span>{j.salary}</span> : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <p className="wa-muted mt-12 text-center text-xs">Powered by MECGURA</p>
      </main>
    </div>
  );
}
