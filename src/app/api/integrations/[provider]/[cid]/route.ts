import { handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { handleStoreWebhook } from "@/services/integrations/stores";

type Ctx = { params: Promise<{ provider: string; cid: string }> };

/** Public: Shopify / WooCommerce webhooks. Authenticated by the HMAC signature, not a session. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { provider, cid } = await params;
  enforceRateLimit(`store-hook:${cid.slice(0, 40)}`, 600, 60_000);
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > 2_000_000) return ok({ status: "too_large" }, { status: 413 });
  return ok(await handleStoreWebhook(provider, cid.slice(0, 40), raw, req.headers));
});
