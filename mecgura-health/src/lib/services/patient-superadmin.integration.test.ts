import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import { exportPatient, getPatientProfile, registerPatient } from "./patient-crm";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));

// A Super Admin who enters a clinic for support is never a clinician: no clinical record, no patient export.
describe("Super Admin in support access", () => {
  it("cannot export a patient file and does not receive the clinical tier", async () => {
    await seedSystemData();
    const t = await db.tenant.create({ data: { name: "SA support", slug: uniq("sa").slice(0, 30), status: "ACTIVE" } });
    const { user: admin } = await makeUser("CLINIC_ADMIN", t.id); const { user: sa } = await makeUser("SUPER_ADMIN", null);
    const adminCtx = asTenant(ctxFor(admin, "CLINIC_ADMIN", t.id)); const saCtx = asTenant(ctxFor(sa, "SUPER_ADMIN", t.id));
    const p = await registerPatient(adminCtx, { name: "Support Test", phone: "9811122233", allowDuplicate: true } as never);
    expect(await code(exportPatient(saCtx, p.id))).toBe("FORBIDDEN");
    const profile = await getPatientProfile(saCtx, p.id).catch(() => null);
    if (profile) expect(JSON.stringify(profile)).not.toMatch(/allerg|medicalHistory/i);
  });
});
