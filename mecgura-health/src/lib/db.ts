import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createClient() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = url.startsWith("postgres")
    ? new PrismaPg({ connectionString: url })
    : new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

/**
 * UNSCOPED Prisma client. Use only for platform-level code (authentication, tenant
 * resolution, seeding, audit writes). Everything tenant-owned must go through
 * `tenantDb(ctx)` from "@/lib/tenant/db", which enforces tenant isolation.
 */
export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
