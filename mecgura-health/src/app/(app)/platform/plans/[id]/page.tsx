import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlanForm, PlanStatusButtons } from "@/components/subscription/plan-form";
import { STATUS_TONE, label } from "@/components/subscription/format";
import { StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getPlanForAdmin } from "@/lib/services/sub-plans";

export const metadata: Metadata = { title: "Edit plan" };
export const dynamic = "force-dynamic";
export default async function EditPlan({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage"); const { id } = await params;
  const plan = await getPlanForAdmin(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-center gap-3"><h1 className="type-page-title">{plan.name}</h1><StatusBadge tone={STATUS_TONE[plan.status]}>{label(plan.status)}</StatusBadge><span className="type-caption">Version {plan.version} · {plan.subscribers} active subscriber(s)</span></div>
      <PlanStatusButtons id={plan.id} status={plan.status} />
      {plan.subscribers > 0 && <p className="type-secondary">Changes apply to NEW subscriptions and renewals only after a customer switches; current subscribers keep the features, limits and price they were sold.</p>}
      <PlanForm plan={plan} />
    </div>
  );
}
