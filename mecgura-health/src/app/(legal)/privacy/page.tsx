import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { Markdown } from "@/components/website/markdown";
import { getLegal } from "@/lib/services/legal";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return { title: (await getLegal("privacy")).title }; }
export default async function Page() {
  const l = await getLegal("privacy");
  return (
    <article>
      <h1 className="type-page-title mb-4">{l.title}</h1>
      {l.draft && <Alert tone="warning" className="mb-6" title="Draft — pending legal review">This page is an outline, not the final text. The platform owner has not yet published the reviewed version.</Alert>}
      {l.updatedAt && <p className="type-caption mb-4">Last updated {new Date(l.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>}
      <Markdown text={l.text} />
    </article>
  );
}
