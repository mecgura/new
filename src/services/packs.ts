import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { INDUSTRY_PACKS, packById } from "@/config/industry-packs";
import { DEFAULT_ACTIONS, DEFAULT_HANDOFF } from "@/lib/ai";
import { DEFAULT_AUTH_OPTIONS } from "@/lib/templates";
import { createAgent } from "@/services/ai/agents";
import { createTemplate } from "@/services/templates/templates";

export function listPacks() {
  return INDUSTRY_PACKS.map((p) => ({ id: p.id, name: p.name, description: p.description, tags: p.tags.length, faqs: p.agent.faqs.length, templates: p.templates.length }));
}

/**
 * Adds a pack's starter content to the workspace as drafts. Existing tags, agents and templates are never changed:
 * the pack skips anything whose name is already taken, so applying it twice is safe.
 */
export async function applyPack(access: OrgAccess, packId: string, req?: Request) {
  const pack = packById(packId);
  if (!pack) throw new ApiError("NOT_FOUND", "Pack not found.");
  const orgId = access.organizationId;

  let tags = 0;
  for (const t of pack.tags) {
    if (await db.tag.findUnique({ where: { organizationId_name: { organizationId: orgId, name: t.name } }, select: { id: true } })) continue;
    await db.tag.create({ data: { organizationId: orgId, name: t.name, color: t.color } });
    tags++;
  }

  let agent = "skipped";
  if (!(await db.aiAgent.findFirst({ where: { organizationId: orgId, name: pack.agent.name } }))) {
    try {
      await createAgent(
        access,
        { name: pack.agent.name, accountIds: [], instructions: pack.agent.instructions, knowledge: { faqs: pack.agent.faqs, products: [], services: [], pricing: "" }, actions: DEFAULT_ACTIONS, handoff: DEFAULT_HANDOFF } as Parameters<typeof createAgent>[1],
        req
      );
      agent = "created";
    } catch (e) {
      agent = e instanceof ApiError ? `not added: ${e.message}` : "not added";
    }
  }

  const waba = await db.whatsAppBusinessAccount.findFirst({ where: { organizationId: orgId, accounts: { some: { status: { in: ["connected", "demo"] } } } }, orderBy: { createdAt: "asc" } });
  let templates = 0;
  let templatesNote = "";
  if (!waba) templatesNote = "Connect a WhatsApp number to add the template drafts.";
  else {
    for (const t of pack.templates) {
      if (await db.messageTemplate.findFirst({ where: { organizationId: orgId, wabaRecordId: waba.id, name: t.name, language: "en" } })) continue;
      try {
        await createTemplate(access, { wabaId: waba.id, name: t.name, language: "en", category: t.category, headerType: "none", headerText: "", body: t.body, footer: t.footer, buttons: [], examples: t.examples, authOptions: DEFAULT_AUTH_OPTIONS }, req);
        templates++;
      } catch {
        templatesNote = "Some template drafts could not be added.";
      }
    }
  }
  await audit({ action: "pack.applied", actorUserId: access.user.id, organizationId: orgId, targetType: "industry_pack", targetId: pack.id, metadata: { tags, agent, templates }, req });
  return { pack: pack.name, tags, agent, templates, templatesNote };
}
