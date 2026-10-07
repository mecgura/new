import Razorpay from "razorpay";
import { getSetting } from "@/lib/settings";

let cached: Razorpay | null = null;
let cachedFor: string | null = null;

/**
 * Server-only Razorpay client.
 * Key ID comes from admin settings (DB), Key Secret ONLY from env (never stored in DB).
 */
export async function getRazorpay(): Promise<{ client: Razorpay; keyId: string; mode: string } | null> {
  const keyId = (await getSetting("razorpay_key_id")).trim();
  const mode = (await getSetting("razorpay_mode", "test")).trim() || "test";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  const cacheKey = `${keyId}:${keySecret.slice(0, 6)}`;
  if (!cached || cachedFor !== cacheKey) {
    cached = new Razorpay({ key_id: keyId, key_secret: keySecret });
    cachedFor = cacheKey;
  }
  return { client: cached, keyId, mode };
}

export function razorpaySecretConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_SECRET?.trim());
}
