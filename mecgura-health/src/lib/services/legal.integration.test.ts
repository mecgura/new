import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getLegal, saveLegal } from "./legal";
import { ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";

describe("legal pages", () => {
  let SA: ReturnType<typeof ctxFor>; let CA: ReturnType<typeof ctxFor>;
  beforeAll(async () => {
    await seedSystemData(); await db.platformSetting.deleteMany({ where: { key: { startsWith: "legal." } } });
    const slug = uniq("legal"); const t = await db.tenant.create({ data: { name: "Legal t", slug, subdomain: slug, status: "ACTIVE", timezone: "Asia/Kolkata" } }); const sa = await makeUser("SUPER_ADMIN", null); const ca = await makeUser("CLINIC_ADMIN", t.id);
    SA = ctxFor(sa.user, "SUPER_ADMIN", null, { grants: sa.grants }); CA = ctxFor(ca.user, "CLINIC_ADMIN", t.id, { grants: ca.grants });
  });
  it("shows a labelled draft outline until the Super Admin publishes text", async () => {
    const l = await getLegal("terms"); expect(l.draft).toBe(true); expect(l.text).toContain("[Company legal name]");
  });
  it("only a Super Admin can publish; clinic users are refused", async () => {
    await expect(saveLegal(SA, { kind: "privacy", text: "## Policy\nReal text." })).resolves.toMatchObject({ saved: true, draft: false });
    expect((await getLegal("privacy")).draft).toBe(false);
    await expect(saveLegal(CA, { kind: "privacy", text: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("empty text restores the draft outline; invalid kind is rejected", async () => {
    await saveLegal(SA, { kind: "privacy", text: "" }); expect((await getLegal("privacy")).draft).toBe(true);
    await expect(saveLegal(SA, { kind: "other", text: "x" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
