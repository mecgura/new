import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/context";
import { getEnv } from "@/lib/env";
import { Showcase } from "./showcase";

export const metadata: Metadata = { title: "Design system" };

/** Visual reference for every token and component. Admins only; hidden in production unless ENABLE_DESIGN_PREVIEW=true. */
export default async function DesignSystemPage() {
  const env = getEnv();
  if (env.isProd && !env.ENABLE_DESIGN_PREVIEW) notFound();
  await requirePagePermission("settings.edit");
  return <Showcase />;
}
