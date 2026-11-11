import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConsultationWorkspace } from "@/components/consultation/consultation-workspace";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getConsultation } from "@/lib/services/consultation";
import { tenantDb } from "@/lib/tenant/db";

export const metadata: Metadata = { title: "Consultation" };
export const dynamic = "force-dynamic";

export default async function ConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("consultation.view");
  const { id } = await params;
  let c;
  try { c = await getConsultation(ctx, id); } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Card className="mx-auto max-w-xl"><CardHeader title="Access denied" /><CardBody><p className="type-secondary">{e.message || "Your role can't open clinical records."}</p></CardBody></Card>;
    throw e;
  }
  const staff = await tenantDb(ctx).user.findMany({ where: { status: "ACTIVE", deletedAt: null, role: { key: { in: ["NURSE", "COMPOUNDER", "RECEPTIONIST", "LAB_STAFF", "STAFF"] } } }, select: { id: true, name: true, role: { select: { key: true } } }, orderBy: { name: "asc" } });
  return <ConsultationWorkspace initial={c} staff={staff.map((s) => ({ id: s.id, name: s.name, role: s.role.key }))} canViewPatient={ctx.permissions.has("patients.view")} />;
}
