import { patientRoute } from "@/lib/api/patient-route";
import { listInvoices } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listInvoices(ctx, { filter: s.get("filter") ?? undefined, page: Number(s.get("page") ?? 1) }); });
