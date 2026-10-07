import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { saveSchedule } from "@/lib/services/schedule";

export const dynamic = "force-dynamic";
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => saveSchedule(ctx, params.doctorId, await readJson(req)));
