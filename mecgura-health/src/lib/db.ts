import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createClient() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("DATABASE_URL is not set. Add the PostgreSQL URL in the hosting environment variables and redeploy.");
  }
  const adapter = url.startsWith("postgres")
    ? new PrismaPg({ connectionString: url })
    : new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

function get(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const c = createClient();
  globalForPrisma.prisma = c; // one client per process (also across dev hot reloads)
  return c;
}

/**
 * UNSCOPED Prisma client. Use only for platform-level code (authentication, tenant
 * resolution, seeding, audit writes). Everything tenant-owned must go through
 * `tenantDb(ctx)` from "@/lib/tenant/db", which enforces tenant isolation.
 *
 * The real client is created on first use, not on import, so `next build` (which imports every route to collect
 * its configuration) does not need a database connection.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) { const c = get(); const v = Reflect.get(c, prop, c); return typeof v === "function" ? v.bind(c) : v; },
  has(_t, prop) { return prop in get(); },
});
