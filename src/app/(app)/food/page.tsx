import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { FoodApp } from "@/components/food/food-app";
import { isServiceEnabled } from "@/services/whatsapp/guards";

export const metadata: Metadata = { title: "Food orders" };

export default async function FoodPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "FOOD_ORDERING"))) return <ServiceLocked name="Food ordering" />;
  const { tab } = await searchParams;
  const canManage = roleHasPermission(ctx.me.role, "food:manage");
  const tabs = canManage ? ["kitchen", "menu", "spots", "settings", "report"] : ["kitchen", "menu"];
  return <FoodApp orgId={ctx.orgId} canManage={canManage} initialTab={tabs.includes(tab ?? "") ? tab! : "kitchen"} />;
}
