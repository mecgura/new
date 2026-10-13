import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { TENANT_CACHE_ACTION, invalidateTenantCaches } from "@/lib/cache/tenant-cache";
import { hmacHex } from "@/lib/security/crypto";
import { logger, redact } from "@/lib/logger";
import { getRequestMeta } from "@/lib/security/request";
import type { AuditAction } from "./actions";

export { AUDIT_ACTIONS, type AuditAction } from "./actions";

export interface AuditInput {
  action: AuditAction;
  tenantId: string | null;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Identifiers / non-sensitive context ONLY. Never medical content, names, or secrets. */
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  /** Phase 16: why a privileged action was taken (kept with the record) */
  reason?: string;
}

/** The exact fields an integrity hash covers. Exported so the verifier recomputes it identically. */
export const auditCanonical = (r: { id: string; action: string; tenantId: string | null; actorId: string | null; entityType: string | null; entityId: string | null; metadata: string | null; ip: string | null; userAgent: string | null; createdAt: Date; reason: string | null }) =>
  JSON.stringify([r.id, r.action, r.tenantId, r.actorId, r.entityType, r.entityId, r.metadata, r.ip, r.userAgent, r.createdAt.toISOString(), r.reason]);

const MAX_METADATA_CHARS = 2000;

/** Redacts, serialises and size-caps audit metadata. Exported for tests. */
export function serializeMetadata(metadata?: Record<string, unknown>): string | null {
  if (!metadata) return null;
  const json = JSON.stringify(redact(metadata));
  return json.length > MAX_METADATA_CHARS ? JSON.stringify({ truncated: true }) : json;
}

/**
 * Append-only audit write. Records WHO did WHAT to WHICH entity, WHEN and from where.
 * A failing audit write is logged but never breaks the user's request.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const meta = input.ip === undefined && input.userAgent === undefined ? await getRequestMeta().catch(() => ({ ip: null, userAgent: null })) : { ip: input.ip ?? null, userAgent: input.userAgent ?? null };
    // Tamper evidence: every record carries an HMAC over its own content (key from the security key ring, never stored with the data).
    const row = { id: randomUUID(), action: input.action as string, tenantId: input.tenantId, actorId: input.actorId ?? null, entityType: input.entityType ?? null, entityId: input.entityId ?? null, metadata: serializeMetadata(input.metadata), ip: meta.ip, userAgent: meta.userAgent, createdAt: new Date(), reason: input.reason?.slice(0, 300) ?? null };
    const sig = hmacHex("audit", auditCanonical(row));
    await db.auditLog.create({ data: { ...row, hash: sig.hmac, hashKeyId: sig.keyId } });
    if (row.tenantId && TENANT_CACHE_ACTION.test(row.action)) invalidateTenantCaches(row.tenantId); // configuration changed: drop cached public-site / host data for this clinic
  } catch (err) {
    logger.error("audit write failed", { action: input.action, error: err });
  }
}
