import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { rolesOverview } from "@/lib/services/platform-admin";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx }) => rolesOverview(ctx));
