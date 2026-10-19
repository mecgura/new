import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { makeOrg } from "../helpers";

describe("seed: modules added later", () => {
  it("switches new modules on once for workspaces already running WhatsApp, and never touches existing rows", async () => {
    const on = await makeOrg("Seed Service On");
    const off = await makeOrg("Seed Service Off");
    await db.organizationService.create({ data: { organizationId: on.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
    await db.organizationService.create({ data: { organizationId: off.id, service: "WHATSAPP_AUTOMATION", enabled: false } });
    const url = process.env.DATABASE_URL ?? "";
    execFileSync("npx", ["tsx", "prisma/seed.ts"], { env: { ...process.env, DATABASE_URL: url, SEED_ADMIN_EMAIL: "", SEED_DEMO_PASSWORD: "" }, stdio: "pipe" });
    const flags = async (id: string) => Object.fromEntries((await db.organizationService.findMany({ where: { organizationId: id } })).map((s) => [s.service, s.enabled]));
    expect(await flags(on.id)).toMatchObject({ OMNICHANNEL: true, AI_CALLING: true, CRM: false });
    expect(await flags(off.id)).toMatchObject({ OMNICHANNEL: false, AI_CALLING: false });
    // An admin switching one off survives the next deploy's seed.
    await db.organizationService.update({ where: { organizationId_service: { organizationId: on.id, service: "AI_CALLING" } }, data: { enabled: false } });
    execFileSync("npx", ["tsx", "prisma/seed.ts"], { env: { ...process.env, DATABASE_URL: url, SEED_ADMIN_EMAIL: "", SEED_DEMO_PASSWORD: "" }, stdio: "pipe" });
    expect((await flags(on.id)).AI_CALLING).toBe(false);
  }, 120_000);
});

describe("seed: AI Assistant becomes a per-client service", () => {
  it("is switched on once for WhatsApp workspaces whose row existed switched off, then left alone", async () => {
    await db.siteSetting.deleteMany({ where: { key: "migration:ai_assistant_service" } });
    const org = await makeOrg("Seed AI");
    await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
    await db.organizationService.create({ data: { organizationId: org.id, service: "AI_ASSISTANT", enabled: false } });
    const run = () => execFileSync("npx", ["tsx", "prisma/seed.ts"], { env: { ...process.env, SEED_ADMIN_EMAIL: "", SEED_DEMO_PASSWORD: "" }, stdio: "pipe" });
    run();
    const row = () => db.organizationService.findUniqueOrThrow({ where: { organizationId_service: { organizationId: org.id, service: "AI_ASSISTANT" } } });
    expect((await row()).enabled).toBe(true);
    await db.organizationService.update({ where: { organizationId_service: { organizationId: org.id, service: "AI_ASSISTANT" } }, data: { enabled: false } });
    run();
    expect((await row()).enabled).toBe(false);
  }, 120_000);
});
