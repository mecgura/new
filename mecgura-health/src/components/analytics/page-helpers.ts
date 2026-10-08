import "server-only";
import { redirect } from "next/navigation";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { tenantDb } from "@/lib/tenant/db";

export type SP = Record<string, string | string[] | undefined>;
export const flat = (sp: SP) => Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

/** Runs a service call for a page: forbidden -> /forbidden, a bad filter -> a readable message, anything else is a real error. */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try { return { ok: true, data: await fn() }; }
  catch (e) {
    if (e instanceof AppError) { if (e.code === "FORBIDDEN" || e.code === "UNAUTHENTICATED") redirect("/forbidden"); if (e.code === "VALIDATION_ERROR" || e.code === "NOT_FOUND") return { ok: false, error: e.message }; }
    throw e;
  }
}
/** Doctors for the filter dropdown. Doctors themselves never get the filter: the server forces their own data. */
export async function doctorOptions(ctx: TenantRequestContext) {
  if (ctx.user.role === "DOCTOR") return undefined;
  return (await tenantDb(ctx).user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 })) as { id: string; name: string }[];
}
