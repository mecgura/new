import type { Metadata } from "next";
import { Building2, Layers, ShieldCheck, UserRound } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { MODULE_STATUS } from "@/config/modules";
import { requirePagePermission } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requirePagePermission("dashboard.view");
  const builtModules = ctx.enabledModules.filter((m) => MODULE_STATUS[m] === "available").length;
  const firstName = ctx.user.name.split(" ")[0];

  // Only REAL facts about this account/workspace — clinic metrics arrive with their modules.
  const facts = [
    { icon: UserRound, label: "Signed in as", value: ROLE_LABELS[ctx.user.role] },
    { icon: Building2, label: "Workspace", value: ctx.tenant?.name ?? "Platform (no clinic)" },
    { icon: Layers, label: "Plan", value: ctx.tenant?.planName ?? "—" },
    { icon: ShieldCheck, label: "Modules live", value: String(builtModules) },
  ];

  return (
    <div className="space-y-section">
      <div>
        <h1 className="type-page-title">Welcome, {firstName}</h1>
        <p className="type-secondary mt-1">Foundation release — your workspace is set up and secured. Clinic modules arrive in the next phases.</p>
      </div>

      <section aria-label="Workspace summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 md:gap-4">
        {facts.map(({ icon: Icon, label, value }) => (
          <Card key={label} className="flex items-center gap-3 p-card">
            <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon className="size-5" /></span>
            <div className="min-w-0"><p className="type-caption">{label}</p><p className="type-card-title truncate">{value}</p></div>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader title="Clinic activity" description="Live OPD, appointments and patient activity will appear here." />
        <CardBody>
          <EmptyState title="No clinic activity yet" description="These modules aren't part of the foundation release. Nothing is shown here rather than placeholder numbers." />
        </CardBody>
      </Card>
    </div>
  );
}
