import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { unzipSync, strFromU8 } from "fflate";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { exportList } from "./data-export";
import { importTemplate, runImport } from "./data-import";
import { registerPatient } from "./patient-crm";

const enc = (s: string) => new TextEncoder().encode(s);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
const PASSWORD = "Correct-Horse-Battery-9";
let A: ReturnType<typeof asTenant>, B: ReturnType<typeof asTenant>, recep: ReturnType<typeof asTenant>, sa: ReturnType<typeof asTenant>, aId = "", bId = "";

async function mk(label: string, role: RoleKey, tenantId: string | null) {
  const { user } = await makeUser(role, tenantId);
  return asTenant(ctxFor(user, role, tenantId as string));
}
beforeAll(async () => {
  await seedSystemData();
  const ta = await db.tenant.create({ data: { name: "Transfer A", slug: uniq("xfa").slice(0, 30), status: "ACTIVE" } });
  const tb = await db.tenant.create({ data: { name: "Transfer B", slug: uniq("xfb").slice(0, 30), status: "ACTIVE" } });
  aId = ta.id; bId = tb.id;
  A = await mk("a", "CLINIC_ADMIN", aId); B = await mk("b", "CLINIC_ADMIN", bId); recep = await mk("r", "RECEPTIONIST", aId);
  const { user: su } = await makeUser("SUPER_ADMIN", null); sa = asTenant(ctxFor(su, "SUPER_ADMIN", aId));
  const bcrypt = (await import("bcryptjs")).default;
  await db.user.update({ where: { id: A.user.id }, data: { passwordHash: await bcrypt.hash(PASSWORD, 4) } });
});

const MED_CSV = [
  "Generic name,Brand name,Strength,Form,Purchase price (₹),MRP,GST %,Prescription needed",
  "Paracetamol,Crocin,500 mg,Tablet,18.50,25,12,No",
  "Amoxicillin,,250 mg,Capsule,40,55.5,12,Yes",
  ",Nameless,10 mg,Tablet,1,2,0,No",
  "Cetirizine,,10 mg,Tablet,abc,5,5,No",
  "Paracetamol,Crocin,500 mg,Tablet,18.50,25,12,No",
].join("\n");

describe("import: medicines", () => {
  it("preview checks every row and writes nothing", async () => {
    const r = await runImport(A, "medicines", { name: "m.csv", bytes: enc(MED_CSV) }, "preview");
    expect({ total: r.total, ok: r.ok, errors: r.errors, duplicates: r.duplicates, created: r.created }).toEqual({ total: 5, ok: 2, errors: 2, duplicates: 1, created: 0 });
    expect(r.rows.find((x) => x.row === 4)?.messages.join(" ")).toMatch(/generic/i);
    expect(r.rows.find((x) => x.row === 5)?.messages.join(" ")).toMatch(/purchase/i);
    expect(r.problemsCsv).toContain("Problem"); expect(await db.medicine.count({ where: { tenantId: aId } })).toBe(0);
  });
  it("commit creates only the valid rows, with prices in paise, audited, and a second run skips them", async () => {
    const r = await runImport(A, "medicines", { name: "m.csv", bytes: enc(MED_CSV) }, "commit");
    expect(r.created).toBe(2);
    const rows = await db.medicine.findMany({ where: { tenantId: aId }, orderBy: { genericName: "asc" } });
    expect(rows.map((m) => [m.genericName, m.purchasePriceMinor, m.sellingPriceMinor, m.taxRateBp, m.prescriptionRequired])).toEqual([["Amoxicillin", 4000, 5550, 1200, true], ["Paracetamol", 1850, 2500, 1200, false]]);
    expect(await db.auditLog.count({ where: { tenantId: aId, action: "data.imported" } })).toBe(1);
    const again = await runImport(A, "medicines", { name: "m.csv", bytes: enc(MED_CSV) }, "commit");
    expect(again.created).toBe(0); expect(again.duplicates).toBe(3);
  });
  it("is tenant-isolated: another clinic's list is neither seen as duplicates nor touched", async () => {
    const r = await runImport(B, "medicines", { name: "m.csv", bytes: enc(MED_CSV) }, "commit");
    expect(r.created).toBe(2); expect(await db.medicine.count({ where: { tenantId: bId } })).toBe(2); expect(await db.medicine.count({ where: { tenantId: aId } })).toBe(2);
  });
  it("is refused for roles without the permission and for a Super Admin", async () => {
    expect(await code(runImport(recep, "medicines", { name: "m.csv", bytes: enc(MED_CSV) }, "preview"))).toBe("FORBIDDEN");
    expect(await code(runImport(sa, "medicines", { name: "m.csv", bytes: enc(MED_CSV) }, "preview"))).toBe("FORBIDDEN");
  });
  it("rejects a file with a missing required column and unknown types", async () => {
    expect(await code(runImport(A, "medicines", { name: "x.csv", bytes: enc("Brand,Strength\nA,B") }, "preview"))).toBe("VALIDATION_ERROR");
    expect(await code(runImport(A, "nonsense", { name: "x.csv", bytes: enc("a\nb") }, "preview"))).toBe("NOT_FOUND");
  });
});

describe("import: patients and others", () => {
  it("patients: converts dates, skips existing phones, reports bad rows, and never overwrites", async () => {
    await registerPatient(A, { name: "Existing Person", phone: "9000000001", allowDuplicate: true });
    const csv = ["Full name,Mobile,Gender,DOB,Blood group", "Gurpreet Singh,9876500001,Male,17/05/1990,b +", "Existing Person,9000000001,,,", "No Phone,,Female,,", "Bad Date,9876500002,Female,31/02/2000,"].join("\n");
    const prev = await runImport(A, "patients", { name: "p.csv", bytes: enc(csv) }, "preview");
    expect({ ok: prev.ok, dup: prev.duplicates, err: prev.errors }).toEqual({ ok: 1, dup: 1, err: 2 });
    const r = await runImport(A, "patients", { name: "p.csv", bytes: enc(csv) }, "commit");
    expect(r.created).toBe(1);
    const p = await db.patient.findFirst({ where: { tenantId: aId, name: "Gurpreet Singh" } });
    expect([p?.dateOfBirth?.toISOString().slice(0, 10), p?.bloodGroup, p?.gender]).toEqual(["1990-05-17", "B+", "MALE"]);
    expect(await db.patient.count({ where: { tenantId: aId, name: "Existing Person" } })).toBe(1);
    expect(await code(runImport(recep, "patients", { name: "p.csv", bytes: enc(csv) }, "preview"))).toBe("FORBIDDEN"); // import needs export-level trust too
  });
  it("suppliers and lab tests import through their normal services", async () => {
    const s = await runImport(A, "suppliers", { name: "s.csv", bytes: enc("Supplier name,Phone,GST\nPunjab Pharma,9876500000,03ABCDE1234F1Z5\nPunjab Pharma,1,1") }, "commit");
    expect([s.created, s.duplicates]).toEqual([1, 1]);
    const l = await runImport(A, "lab-tests", { name: "l.csv", bytes: enc("Test code,Test name,Category,Turnaround (hours)\ncbc,Complete Blood Count,Haematology,6\nCBC,Again,Haematology,6\nx,,Haematology,") }, "commit");
    expect([l.created, l.duplicates, l.errors]).toEqual([1, 1, 1]);
    expect((await db.investigation.findFirst({ where: { tenantId: aId, testCode: "CBC" } }))?.turnaroundHours).toBe(6);
  });
  it("templates list the columns and are permission checked", () => {
    expect(importTemplate(A, "medicines").columns[0].label).toBe("Generic name *");
    expect(() => importTemplate(recep, "medicines")).toThrow();
  });
});

describe("export", () => {
  it("medicines export is a real workbook with rupees, neutralises formula text, and is clinic-scoped", async () => {
    await db.medicine.updateMany({ where: { tenantId: aId, genericName: "Amoxicillin" }, data: { brandName: "=HYPERLINK(\"http://evil\")" } });
    const out = await exportList(A, "medicines", "xlsx");
    expect(out.filename).toMatch(/medicines-\d{4}-\d{2}-\d{2}\.xlsx$/); expect(out.rows).toBe(2);
    const sheet = strFromU8(unzipSync(out.body as Uint8Array)["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("Paracetamol"); expect(sheet).toContain("18.5"); expect(sheet).toContain("HYPERLINK"); expect(sheet).toContain('t="inlineStr"'); expect(sheet).not.toContain("<f>"); // text cells in the workbook are inline strings: never evaluated
    const csv = (await exportList(A, "medicines", "csv")).body as string;
    expect(csv.startsWith("﻿")).toBe(true); expect(csv).toContain("'=HYPERLINK"); expect(csv.split("\r\n")[0]).toContain("Generic name");
  });
  it("the patients list needs the password, is audited, and exports only demographics", async () => {
    expect(await code(exportList(A, "patients", "csv"))).toBe("FORBIDDEN");
    expect(await code(exportList(A, "patients", "csv", { password: "wrong-password" }))).toBe("FORBIDDEN");
    const out = await exportList(A, "patients", "csv", { password: PASSWORD });
    const csv = out.body as string; expect(csv).toContain("Gurpreet Singh"); expect(csv).toContain("1990-05-17"); expect(csv.split("\r\n")[0]).not.toMatch(/allerg|history|diagnos|note/i);
    expect(csv).not.toContain("Transfer B"); expect(await db.auditLog.count({ where: { tenantId: aId, action: "data.exported" } })).toBeGreaterThan(0);
  });
  it("roles without permission and Super Admin cannot export; clinic B only sees its own", async () => {
    expect(await code(exportList(recep, "patients", "csv", { password: PASSWORD }))).toBe("FORBIDDEN");
    expect(await code(exportList(sa, "medicines", "csv"))).toBe("FORBIDDEN");
    expect((await exportList(B, "medicines", "csv")).rows).toBe(2);
    expect(await code(exportList(A, "everything", "csv"))).toBe("NOT_FOUND");
  });
});
