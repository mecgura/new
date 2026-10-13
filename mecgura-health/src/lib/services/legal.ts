import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { recordAudit } from "@/lib/audit";
import { getPlatformSettingRaw, invalidatePlatformSetting } from "@/lib/platform/runtime";
import type { RequestContext } from "@/lib/auth/context";
import { LEGAL_DEFAULTS, LEGAL_KINDS, LEGAL_TITLES, type LegalKind } from "@/lib/legal/defaults";

const key = (k: LegalKind) => `legal.${k}`;
/** Public read. `draft` is true while the platform still shows the built-in outline text. */
export async function getLegal(kind: LegalKind): Promise<{ title: string; text: string; draft: boolean; updatedAt: string | null }> {
  const raw = await getPlatformSettingRaw(key(kind));
  try { const v = raw ? (JSON.parse(raw) as { text?: string; updatedAt?: string }) : null; if (v?.text?.trim()) return { title: LEGAL_TITLES[kind], text: v.text, draft: false, updatedAt: v.updatedAt ?? null }; } catch { /* fall through to the outline */ }
  return { title: LEGAL_TITLES[kind], text: LEGAL_DEFAULTS[kind], draft: true, updatedAt: null };
}
const schema = z.object({ kind: z.enum(LEGAL_KINDS), text: z.string().max(40_000) });
export async function saveLegal(ctx: RequestContext, raw: unknown) {
  if (ctx.user.role !== "SUPER_ADMIN" || !ctx.permissions.has("platform.manage")) throw new AppError("FORBIDDEN");
  const p = schema.safeParse(raw); if (!p.success) throw new AppError("VALIDATION_ERROR", { message: "The page text is too long or invalid." });
  const text = p.data.text.trim(); const k = key(p.data.kind);
  if (!text) { await db.platformSetting.deleteMany({ where: { key: k } }); } else { const value = JSON.stringify({ text, updatedAt: new Date().toISOString() }); await db.platformSetting.upsert({ where: { key: k }, update: { value, updatedById: ctx.user.id }, create: { key: k, value, updatedById: ctx.user.id } }); }
  invalidatePlatformSetting(k);
  await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_SETTINGS_CHANGED, tenantId: null, actorId: ctx.user.id, entityType: "platform_settings", entityId: k, metadata: { kind: p.data.kind, length: text.length, resetToOutline: !text } });
  return { saved: true, draft: !text };
}
