import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { logoutEverywhere } from "@/lib/services/sec-account";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({}, async ({ ctx }) => logoutEverywhere(ctx));
