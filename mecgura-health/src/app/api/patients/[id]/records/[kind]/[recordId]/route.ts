import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { isKind, updateRecord } from "@/lib/services/patient-records";

export const dynamic = "force-dynamic";
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => { if (!isKind(params.kind)) throw new AppError("NOT_FOUND"); return updateRecord(ctx, params.id, params.kind, params.recordId, await readJson(req)); });
