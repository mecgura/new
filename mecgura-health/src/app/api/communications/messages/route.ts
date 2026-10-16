import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listMessages } from "@/lib/services/comms-staff";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => listMessages(ctx, Object.fromEntries(new URL(req.url).searchParams)));
