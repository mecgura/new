import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

const roleIds = new Map<string, string>();

/** System role id by key (cached). */
export async function getRoleId(key: string): Promise<string> {
  const cached = roleIds.get(key);
  if (cached) return cached;
  const role = await db.role.findFirst({ where: { key, tenantId: null }, select: { id: true } });
  if (!role) throw new AppError("INTERNAL", { message: `System role ${key} is missing. Run the seed.` });
  roleIds.set(key, role.id);
  return role.id;
}

/** Case-insensitive "contains" that works on both SQLite (dev) and PostgreSQL (prod). */
export function containsCI(value: string) {
  const pg = (process.env.DATABASE_URL ?? "").startsWith("postgres");
  return pg ? { contains: value, mode: "insensitive" as const } : { contains: value };
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function newInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
}
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function changedKeys<T extends Record<string, unknown>>(before: Record<string, unknown>, after: T): string[] {
  return Object.keys(after).filter((k) => after[k] !== undefined && (before[k] ?? null) !== (after[k] ?? null));
}

export function uniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

export const PAGE_SIZE = 10;
export function pageParams(page: number | undefined, size = PAGE_SIZE) {
  const p = Math.max(1, Math.floor(page || 1));
  return { skip: (p - 1) * size, take: size, page: p };
}
