import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { platformSettings, updateDefaults } from "@/lib/services/platform-admin";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx }) => platformSettings(ctx));
export const PUT = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => updateDefaults(ctx, await readJson(req)));
