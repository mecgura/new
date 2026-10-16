import { apiRoute } from "@/lib/api/handler";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe. Public, reveals nothing except up/down. */
export const GET = apiRoute<null>({ auth: false }, async () => {
  await db.$queryRaw`SELECT 1`;
  return { status: "ok" };
});
