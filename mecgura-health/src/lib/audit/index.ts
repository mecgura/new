import "server-only";
import { db } from "@/lib/db";
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
}

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
    await db.auditLog.create({
      data: {
        action: input.action,
        tenantId: input.tenantId,
        actorId: input.actorId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: serializeMetadata(input.metadata),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  } catch (err) {
    logger.error("audit write failed", { action: input.action, error: err });
  }
}
