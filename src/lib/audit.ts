import { db } from "@/lib/db";
import type { AuditAction } from "@/lib/audit-actions";

export { AUDIT_ACTIONS, describeAction, type AuditAction } from "@/lib/audit-actions";

// Keys whose values must never be persisted in audit metadata.
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|hash|otp|signature/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.slice(0, 500);
  return value;
}

export type AuditInput = {
  action: AuditAction;
  actorUserId?: string | null;
  organizationId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
};

/** Records an audit event. Never throws — auditing must not break the request. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const fwd = input.req?.headers.get("x-forwarded-for");
    await db.auditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId ?? null,
        organizationId: input.organizationId ?? null,
        targetType: input.targetType ?? "",
        targetId: input.targetId ?? "",
        metadata: JSON.stringify(redact(input.metadata ?? {})),
        ip: (fwd?.split(",")[0] ?? input.req?.headers.get("x-real-ip") ?? "").trim().slice(0, 64),
        userAgent: (input.req?.headers.get("user-agent") ?? "").slice(0, 300),
      },
    });
  } catch (e) {
    console.error("[audit] failed to record", input.action, e);
  }
}

export function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
