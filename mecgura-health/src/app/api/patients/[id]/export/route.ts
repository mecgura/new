import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { exportPatient } from "@/lib/services/patient-crm";

export const dynamic = "force-dynamic";
/** POST (not GET) so it is CSRF-checked; the file is generated per request and returned in the response, never stored or linked. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => exportPatient(ctx, params.id));
