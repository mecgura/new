import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEncryptionConfigured } from "@/lib/crypto";
import { isMetaConfigured } from "@/providers/meta/config";

/**
 * Liveness + readiness probe for load balancers / uptime monitors. Public, so it only says
 * whether things work — never which values are set, versions, hostnames or error text.
 */
export async function GET() {
  let database = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  const checks = {
    database,
    credentialEncryption: isEncryptionConfigured(),
    authSecret: Boolean(process.env.AUTH_SECRET),
  };
  const ok = checks.database && checks.authSecret;
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks, integrations: { whatsapp: isMetaConfigured() ? "live" : "demo" } },
    { status: ok ? 200 : 503 }
  );
}
