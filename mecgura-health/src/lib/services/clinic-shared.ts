import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { AppError } from "@/lib/errors";

/** Prisma-compatible client or transaction (raw or tenant-scoped). Loosely typed on purpose: used by both. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Client = any;

export async function tenantTimezone(tenantId: string): Promise<string> {
  const t = await db.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { timezone: true } });
  return t?.timezone ?? "Asia/Kolkata";
}

export async function activeTenant(tenantId: string) {
  const t = await db.tenant.findFirst({ where: { id: tenantId, deletedAt: null, status: { in: [...TENANT_ACCESS_STATUSES] } }, select: { id: true, name: true, timezone: true } });
  if (!t) throw new AppError("NOT_FOUND", { message: "This clinic isn't available right now." });
  return t;
}

/** Atomic per-clinic counter (call INSIDE a transaction). */
export async function nextCounter(tx: Client, tenantId: string, key: string): Promise<number> {
  const row = await tx.tenantCounter.upsert({ where: { tenantId_key: { tenantId, key } }, update: { value: { increment: 1 } }, create: { tenantId, key, value: 1 }, select: { value: true } });
  return row.value as number;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 8 unambiguous characters; shown to patients, so it has to be unguessable-enough and easy to read out. */
export function randomCode(len = 8): string {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
export const newPublicToken = () => randomBytes(9).toString("base64url");
export const newDisplayKey = () => randomBytes(12).toString("base64url");

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export const maskPhone = (p: string | null | undefined) => (p ? `••••••${p.slice(-4)}` : "—");
export const ageLabel = (p: { dateOfBirth: Date | null; ageYears: number | null }, now = new Date()) => {
  if (p.dateOfBirth) { let a = now.getUTCFullYear() - p.dateOfBirth.getUTCFullYear(); const m = now.getUTCMonth() - p.dateOfBirth.getUTCMonth(); if (m < 0 || (m === 0 && now.getUTCDate() < p.dateOfBirth.getUTCDate())) a--; return `${a} y`; }
  return p.ageYears != null ? `${p.ageYears} y` : null;
};
/** "Rahul Sharma" -> "Rahul S." (calendar cells avoid showing full names) */
export const shortName = (n: string) => { const [first, ...rest] = n.trim().split(/\s+/); return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first; };

/** A user of this clinic who is an ACTIVE doctor. */
export async function assertTenantDoctor(client: Client, doctorUserId: string, tenantId?: string) {
  const d = await client.user.findFirst({ where: { id: doctorUserId, ...(tenantId ? { tenantId } : {}), role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true } });
  if (!d) throw new AppError("VALIDATION_ERROR", { message: "Choose a doctor from this clinic.", fieldErrors: { doctorUserId: "Choose a doctor from this clinic." } });
  return d as { id: string; name: string };
}
