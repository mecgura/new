import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { providerMonitor, webhookMonitor } from "@/lib/services/platform-monitor";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx }) => ({ providers: await providerMonitor(ctx), webhooks: await webhookMonitor(ctx) }));
