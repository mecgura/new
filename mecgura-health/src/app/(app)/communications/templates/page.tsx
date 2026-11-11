import type { Metadata } from "next";
import { TemplateManager } from "@/components/communications/template-manager";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Message templates" };
export const dynamic = "force-dynamic";
export default async function Page() { await requireTenantPagePermission("communications.templates"); return <TemplateManager />; }
