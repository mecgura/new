import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { createRecord, isKind, listRecords } from "@/lib/services/patient-records";

export const dynamic = "force-dynamic";
const kindOf = (k: string) => { if (!isKind(k)) throw new AppError("NOT_FOUND"); return k; };
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => listRecords(ctx, params.id, kindOf(params.kind)));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => createRecord(ctx, params.id, kindOf(params.kind), await readJson(req)));
