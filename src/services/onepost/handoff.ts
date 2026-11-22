import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { LANGUAGE_CODES, variablesIn, type TemplateDef } from "@/lib/templates";
import { PUBLISHABLE } from "@/services/onepost/state";
import { assertServiceEnabled, assertWhatsAppEnabled } from "@/services/whatsapp/guards";
import { createTemplate, listTemplateAccounts } from "@/services/templates/templates";

const LANG: Record<string, string> = { en: "en", hinglish: "en", hi: "hi", pa: "pa" };
const SAMPLE = ["Ravi", "Sample", "Sample", "Sample", "Sample"];

/**
 * Passes the approved WhatsApp text to the EXISTING Templates and Campaigns system as a DRAFT template. Nothing is submitted to Meta and nothing
 * is sent: a person reviews it in Templates, submits it for Meta's approval, and then sends it to opted-in contacts from Campaigns.
 */
export async function handoffWhatsApp(a: OrgAccess, postId: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  await assertWhatsAppEnabled(a.organizationId);
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  if (!PUBLISHABLE.includes(post.status) || !post.approvedAt) throw new ApiError("CONFLICT", "Only an approved post can be passed to Templates.");
  const v = await db.onePostVersion.findUnique({ where: { postId_channel: { postId, channel: "whatsapp" } } });
  if (!v) throw new ApiError("VALIDATION_ERROR", "Write the WhatsApp version first.");
  const content = JSON.parse(v.content) as { body: string; suggestedCategory: "MARKETING" | "UTILITY" };
  const wabas = await listTemplateAccounts(a.organizationId);
  if (!wabas.length) throw new ApiError("VALIDATION_ERROR", "Connect a WhatsApp number first (WhatsApp → Connect).");

  let body = content.body.trim();
  // Meta does not accept a template that starts or ends with a variable.
  if (/^\{\{\s*\d+\s*\}\}/.test(body)) body = `Hi ${body}`;
  if (/\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(body)) body = `${body.replace(/[\s]+$/, "")}.`.replace(/\.\.$/, ".");
  const n = Math.max(0, ...variablesIn(body));
  const slug = post.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "post";
  const def: TemplateDef & { wabaId: string } = {
    wabaId: wabas[0].id,
    name: `onepost_${slug}_${Math.random().toString(36).slice(2, 6)}`,
    language: LANGUAGE_CODES.includes(LANG[post.language] ?? "en") ? (LANG[post.language] ?? "en") : "en",
    category: content.suggestedCategory === "UTILITY" ? "UTILITY" : "MARKETING",
    headerType: "none",
    headerText: "",
    body,
    footer: "",
    buttons: [],
    examples: n ? { body: SAMPLE.slice(0, n) } : {},
    authOptions: { addSecurityRecommendation: true, codeExpirationMinutes: 10, buttonText: "Copy code" },
  };
  const t = await createTemplate(a, def, req);
  await db.onePostEvent.create({ data: { organizationId: a.organizationId, postId, actorUserId: a.user.id, action: "whatsapp_handoff", note: JSON.stringify({ id: t.id, name: t.name }) } });
  await audit({ action: "onepost.handoff", actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost", targetId: postId, metadata: { templateId: t.id }, req });
  return { template: { id: t.id, name: t.name, status: t.status, category: t.category }, url: `/templates/${t.id}` };
}

/** Drafts already created from this post (newest first). */
export async function listHandoffs(organizationId: string, postId: string) {
  const ev = await db.onePostEvent.findMany({ where: { organizationId, postId, action: "whatsapp_handoff" }, orderBy: { createdAt: "desc" }, take: 10 });
  const out: { id: string; name: string; createdAt: Date; url: string }[] = [];
  for (const e of ev) {
    try {
      const j = JSON.parse(e.note) as { id: string; name: string };
      out.push({ id: j.id, name: j.name, createdAt: e.createdAt, url: `/templates/${j.id}` });
    } catch {
      /* ignore */
    }
  }
  return out;
}
