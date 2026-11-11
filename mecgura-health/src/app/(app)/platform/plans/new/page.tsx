import type { Metadata } from "next";
import { PlanForm } from "@/components/subscription/plan-form";
import { requirePagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "New plan" };
export default async function NewPlan() { await requirePagePermission("platform.manage"); return <div className="space-y-section"><h1 className="type-page-title">New plan</h1><PlanForm plan={null} /></div>; }
