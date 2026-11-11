import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listPatients, registerPatient } from "@/lib/services/patient-crm";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => listPatients(ctx, Object.fromEntries(new URL(req.url).searchParams)));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => registerPatient(ctx, await readJson(req)));
