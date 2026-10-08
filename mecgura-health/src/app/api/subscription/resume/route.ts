import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { resumeSubscription } from "@/lib/services/sub-core";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.manage" }, async ({ ctx }) => { await resumeSubscription(ctx); return { resumed: true }; });
