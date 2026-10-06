import { AppError } from "@/lib/errors";

type Args = Record<string, unknown> | undefined;

const READ_WHERE_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany",
]);
const UNIQUE_WHERE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete"]);
const READ_OPS = new Set(["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);

function assertNoForeignTenant(data: unknown, tenantId: string) {
  if (data && typeof data === "object" && "tenantId" in data) {
    const supplied = (data as { tenantId?: unknown }).tenantId;
    if (supplied !== undefined && supplied !== tenantId) {
      throw new AppError("FORBIDDEN", { message: "Cross-tenant write blocked." });
    }
  }
}

/**
 * Rewrites Prisma operation args so they can only touch rows of `tenantId`.
 * Pure + exhaustively unit-tested — this is a security boundary.
 */
export function scopeArgs(operation: string, rawArgs: Args, tenantId: string, opts: { softDelete?: boolean } = {}): Record<string, unknown> {
  if (!tenantId) throw new AppError("FORBIDDEN", { message: "Missing tenant context." });
  const args: Record<string, unknown> = { ...(rawArgs ?? {}) };
  const andDeleted = (where: Record<string, unknown>) =>
    opts.softDelete && READ_OPS.has(operation) ? { ...where, deletedAt: null } : where;

  if (READ_WHERE_OPS.has(operation)) {
    const where = (args.where as Record<string, unknown> | undefined) ?? {};
    args.where = andDeleted({ AND: [where, { tenantId }] });
    if (operation === "updateMany") assertNoForeignTenant(args.data, tenantId);
    return args;
  }
  if (UNIQUE_WHERE_OPS.has(operation)) {
    args.where = andDeleted({ ...(args.where as Record<string, unknown>), tenantId });
    if (operation === "update") assertNoForeignTenant(args.data, tenantId);
    return args;
  }
  if (operation === "create") {
    assertNoForeignTenant(args.data, tenantId);
    args.data = { ...(args.data as Record<string, unknown>), tenantId };
    return args;
  }
  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(args.data) ? args.data : [args.data];
    rows.forEach((r) => assertNoForeignTenant(r, tenantId));
    args.data = rows.map((r) => ({ ...(r as Record<string, unknown>), tenantId }));
    return args;
  }
  if (operation === "upsert") {
    assertNoForeignTenant(args.create, tenantId);
    assertNoForeignTenant(args.update, tenantId);
    args.where = { ...(args.where as Record<string, unknown>), tenantId };
    args.create = { ...(args.create as Record<string, unknown>), tenantId };
    return args;
  }
  // Unknown operation (e.g. raw queries) on a scoped model: refuse rather than guess.
  throw new AppError("FORBIDDEN", { message: `Operation "${operation}" is not allowed on tenant-scoped data.` });
}
