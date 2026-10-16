import { apiRoute, readJson } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import type { RequestContext } from "@/lib/auth/context";
import { billingSettings, savePolicy, saveTax, saveVendor } from "@/lib/services/sub-config";
import { providerStatus } from "@/lib/services/sub-admin";
import { stepUp } from "@/lib/services/platform-core";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx }) => ({ ...(await billingSettings(ctx)), provider: providerStatus(ctx) }));
/** { section: "policy"|"tax"|"vendor", values, password } */
export const PUT = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => {
  const b = (await readJson(req)) as { section?: string; values?: unknown; password?: string };
  await stepUp(ctx, b.password, "subscription_settings");
  if (b.section === "policy") return savePolicy(ctx, b.values); if (b.section === "tax") return saveTax(ctx, b.values); if (b.section === "vendor") return saveVendor(ctx, b.values);
  throw new AppError("VALIDATION_ERROR", { message: "Unknown settings section." });
});
