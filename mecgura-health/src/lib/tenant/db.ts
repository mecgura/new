import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { scopeArgs } from "./scope";
import { TENANT_SCOPED_MODELS } from "./scoped-models";

/**
 * Prisma client bound to ONE tenant. Every query on a model registered in
 * TENANT_SCOPED_MODELS is rewritten server-side so it can only read/write that tenant's rows,
 * regardless of what the caller (or a tampered request) passes in `where`/`data`.
 *
 *   const tdb = tenantDb(ctx);       // ctx comes from requireTenantContext()
 *   await tdb.user.findMany();       // only this clinic's users
 */
export function tenantDb(ctx: { tenantId: string }) {
  const tenantId = ctx.tenantId;
  if (!tenantId) throw new AppError("FORBIDDEN", { message: "Missing tenant context." });
  return db.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const cfg = TENANT_SCOPED_MODELS[model];
          if (!cfg) return query(args);
          return query(scopeArgs(operation, args as Record<string, unknown>, tenantId, cfg) as typeof args);
        },
      },
    },
  });
}
