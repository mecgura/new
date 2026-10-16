import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { PublishBar } from "@/components/website/publish-bar";
import { Alert, Card, CardBody, CardHeader, Progress, StatusBadge } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { overview } from "@/lib/services/website-content";

export const metadata: Metadata = { title: "Website" };

export default async function WebsiteOverview() {
  const ctx = await requireTenantPagePermission("website.view");
  const o = await overview(ctx);
  const required = o.checklist.filter((c) => !c.optional);
  const done = required.filter((c) => c.done).length;
  return (
    <div className="space-y-section">
      <Card>
        <CardHeader title="Website status" description={o.publishedAt ? `Last published ${o.publishedAt.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : "Not published yet"} />
        <CardBody><PublishBar status={o.status} hasChanges={o.hasUnpublishedChanges} canPublish={ctx.permissions.has("website.publish")} /></CardBody>
      </Card>
      {o.newEnquiries > 0 && <Alert tone="info" title={`${o.newEnquiries} new enquir${o.newEnquiries === 1 ? "y" : "ies"}`}><Link href="/website/enquiries">Open enquiries</Link></Alert>}
      <Card>
        <CardHeader title="Setup checklist" description="Everything shown on your website comes from what you add here." />
        <CardBody className="space-y-4">
          <Progress label="Required setup" value={done} max={required.length} />
          <ul className="divide-y divide-line">
            {o.checklist.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-3 py-2.5">
                {c.done ? <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" /> : <Circle aria-hidden className="size-5 shrink-0 text-muted" />}
                <span className="type-body min-w-0 flex-1">{c.label}{c.optional && <span className="type-caption"> · optional</span>}<span className="sr-only">{c.done ? " — done" : " — not done"}</span></span>
                {!c.done && <Link href={c.href} className="type-caption !text-primary shrink-0 font-semibold">{c.hint ?? "Set up"}</Link>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card><CardHeader title="Custom domain" action={<StatusBadge tone={o.domainStatus === "ACTIVE" ? "success" : o.domainStatus === "NOT_CONNECTED" ? "neutral" : "warning"}>{o.domainStatus.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</StatusBadge>} description="Manage under the Domain tab." /></Card>
    </div>
  );
}
