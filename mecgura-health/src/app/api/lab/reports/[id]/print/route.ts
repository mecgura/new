import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { recordReportAccess } from "@/lib/services/lab-results";

export const dynamic = "force-dynamic";
/** Called right before window.print() (and when a report is opened) so access is audited. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => { const b = (await readJson(req)) as { version?: unknown; kind?: unknown }; return recordReportAccess(ctx, params.id, b.kind === "VIEWED" ? "VIEWED" : "PRINTED", Number(b.version) || 1); });
