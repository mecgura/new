import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { appointmentAction, getAppointment } from "@/lib/services/appointments";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "appointments.view" }, async ({ ctx, params }) => getAppointment(ctx, params.id));
/** Body: { action: "confirm" | "cancel" | "reschedule" | "check-in" | "no-show" | "update", ... }. Status is never sent by the client. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => appointmentAction(ctx, params.id, await readJson(req)));
