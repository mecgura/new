import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createStaffAppointment, listAppointments } from "@/lib/services/appointments";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "appointments.view" }, async ({ req, ctx }) => listAppointments(ctx, Object.fromEntries(new URL(req.url).searchParams)));
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "appointments.create" }, async ({ req, ctx }) => createStaffAppointment(ctx, await readJson(req)));
