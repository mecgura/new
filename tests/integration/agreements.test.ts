import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as orgAgreements from "@/app/api/admin/organizations/[id]/agreements/route";
import * as agreementRoute from "@/app/api/admin/agreements/[agreementId]/route";
import * as sendRoute from "@/app/api/admin/agreements/[agreementId]/send/route";
import * as settingsRoute from "@/app/api/admin/agreements/settings/route";
import * as adminDoc from "@/app/api/admin/agreements/documents/[docId]/route";
import * as pub from "@/app/api/agreement/[token]/route";
import * as pubDocs from "@/app/api/agreement/[token]/documents/route";
import * as pubSign from "@/app/api/agreement/[token]/sign/route";
import * as clientsRoute from "@/app/api/admin/organizations/route";
import { TEMPLATE_BODY, TEMPLATE_NAME, agreementProgress, saveProvider, workspaceAgreement } from "@/services/agreements/agreements";
import { sha256 } from "@/services/agreements/terms";
import { resetRateLimits } from "@/lib/rate-limit";

let n = 0;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
const uploadReq = (kind: string, bytes: Uint8Array, type = "application/pdf", name = "gst.pdf") => {
  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request("http://localhost:3000/x", { method: "POST", body: fd, headers: { host: "localhost:3000" } });
};

async function client() {
  const admin = await makeUser({ role: "SUPER_ADMIN", name: "Guri" });
  const org = await makeOrg(`Agreement Client ${n++}`);
  const owner = await makeUser({ name: "Ravi Kumar" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await db.organization.update({ where: { id: org.id }, data: { contactPhone: "9876543210", contactEmail: "ravi@example.com" } });
  const plan = await makePlan({ name: `Growth ${n}`, priceMonthly: 299900 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: 299900 } });
  return { admin, org, owner };
}

/** MECGURA's own workspace with a demo number and an approved agreement template, set as the sending number. */
async function mecguraNumber(admin: Awaited<ReturnType<typeof makeUser>>) {
  const org = await makeOrg(`MECGURA ${n++}`);
  const owner = await makeUser({ name: "MECGURA owner" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: 0 } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(req("/x", { method: "POST", body: { businessName: "MECGURA" } }), params({ orgId: org.id })));
  const accountId = (d.body.account as { id: string }).id;
  const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
  await db.messageTemplate.create({ data: { organizationId: org.id, wabaRecordId: acct.wabaRecordId!, name: TEMPLATE_NAME, language: "en", category: "UTILITY", status: "approved", body: TEMPLATE_BODY } });
  actAs(admin);
  await saveProvider({ legalName: "MECGURA", address: "Ludhiana", gstin: "", email: "", phone: "", signatoryName: "Guri", signatoryTitle: "Founder", jurisdiction: "Ludhiana, Punjab", sendFromAccountId: accountId }, admin.id);
  return { org, accountId };
}

afterAll(async () => {
  const admin = await db.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (admin) await saveProvider({ legalName: "MECGURA", address: "", gstin: "", email: "", phone: "", signatoryName: "", signatoryTitle: "Founder", jurisdiction: "", sendFromAccountId: "" }, admin.id);
});

describe("client agreements", () => {
  it("is prefilled from the client, sent on WhatsApp + email, and signed by the client with proof", async () => {
    resetRateLimits();
    const { admin, org } = await client();
    const mec = await mecguraNumber(admin);
    actAs(admin);

    const c = await json(await orgAgreements.POST(req("/x", { method: "POST" }), params({ id: org.id })));
    expect(c.status).toBe(201);
    const a = c.body.agreement as { id: string; link: string; number: string; details: Record<string, unknown>; manualWhatsApp: string };
    expect(a.number).toMatch(/^MGC-AGR-\d{4}-\d{4}$/);
    expect(a.details).toMatchObject({ businessName: org.name, contactName: "Ravi Kumar", phone: "+919876543210", email: "ravi@example.com", pricePaise: 299900 });
    expect(a.manualWhatsApp).toContain("wa.me/919876543210");
    // A second "create" returns the open one instead of a duplicate.
    expect(((await json(await orgAgreements.POST(req("/x", { method: "POST" }), params({ id: org.id })))).body.agreement as { id: string }).id).toBe(a.id);

    const s = await json(await sendRoute.POST(req("/x", { method: "POST", body: { whatsapp: true, email: true } }), params({ agreementId: a.id })));
    expect(s.status).toBe(200);
    const log = s.body.log as { whatsapp: { sent: boolean; message: string }; email: { sent: boolean } };
    expect(log.whatsapp.sent, log.whatsapp.message).toBe(true);
    expect(log.email.sent).toBe(true);
    const msg = await db.message.findFirst({ where: { organizationId: mec.org.id, type: "template" }, orderBy: { createdAt: "desc" } });
    expect(msg?.body).toContain(a.link);
    expect(msg?.payload).toContain('"origin":"agreement"');

    // The client opens the link: no login needed.
    const token = a.link.split("/").pop()!;
    actAs(null);
    const g = await json(await pub.GET(req("/x"), params({ token })));
    expect(g.status).toBe(200);
    expect((g.body.agreement as { status: string }).status).toBe("sent");
    expect((await pub.GET(req("/x"), params({ token: "x".repeat(32) }))).status).toBe(404);

    // Corrects a mistake in their details; bad GSTIN is refused.
    const base = { businessName: "Ravi Traders", contactName: "Ravi Kumar Sharma", phone: "98765 43211", email: "ravi@example.com", city: "Ludhiana", state: "Punjab", pincode: "141001" };
    expect((await pub.PUT(req("/x", { method: "PUT", body: { ...base, gstin: "12345" } }), params({ token }))).status).toBe(400);
    const u = await json(await pub.PUT(req("/x", { method: "PUT", body: { ...base, gstin: "03abcde1234f1z5" } }), params({ token })));
    expect(u.status).toBe(200);
    expect((u.body.agreement as { details: Record<string, unknown> }).details).toMatchObject({ businessName: "Ravi Traders", phone: "+919876543211", gstin: "03ABCDE1234F1Z5" });

    // Signing needs a business proof first.
    const signBody = { signerName: "Ravi Kumar Sharma", designation: "Owner", accept: true };
    expect((await pubSign.POST(req("/x", { method: "POST", body: signBody }), params({ token }))).status).toBe(400);
    // A renamed text file is refused; a real PDF is stored.
    expect((await pubDocs.POST(uploadReq("gst", new TextEncoder().encode("not a pdf")), params({ token }))).status).toBe(400);
    const up = await json(await pubDocs.POST(uploadReq("gst", PDF), params({ token })));
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect((up.body.agreement as { documents: unknown[] }).documents).toHaveLength(1);
    // Tick is required.
    expect((await pubSign.POST(req("/x", { method: "POST", body: { ...signBody, accept: false } }), params({ token }))).status).toBe(400);

    const sg = await json(await pubSign.POST(req("/x", { method: "POST", body: signBody, headers: { "x-forwarded-for": "49.36.1.2", "user-agent": "TestPhone" } }), params({ token })));
    expect(sg.status).toBe(200);
    const signed = await db.clientAgreement.findUniqueOrThrow({ where: { id: a.id } });
    expect(signed).toMatchObject({ status: "signed", signerName: "Ravi Kumar Sharma", signerIp: "49.36.1.2", signerAgent: "TestPhone" });
    expect(signed.signedHash).toBe(sha256(signed.signedText));
    expect(signed.signedText).toContain("Ravi Traders");
    expect(signed.signedText).toContain("Ludhiana, Punjab");
    // The public link shows the agreement (whose accepted text records the IP), never the stored device, internal ids, the token or the send log.
    const view = JSON.stringify((await json(await pub.GET(req("/x"), params({ token })))).body);
    for (const leak of ["TestPhone", "signerIp", a.organizationId, "sendLog", "createdById", `"token"`]) expect(view).not.toContain(leak);
    expect(view).toContain("Ravi Traders");
    // Locked after signing.
    expect((await pub.PUT(req("/x", { method: "PUT", body: base }), params({ token }))).status).toBe(409);
    expect((await pubSign.POST(req("/x", { method: "POST", body: signBody }), params({ token }))).status).toBe(409);

    // Admin corrects a signed agreement: a new version, the signed one is kept, the client record follows.
    actAs(admin);
    const detail = (await json(await agreementRoute.GET(req("/x"), params({ agreementId: a.id })))).body.agreement as { details: Record<string, unknown> };
    const fix = await json(await agreementRoute.PUT(req("/x", { method: "PUT", body: { ...detail.details, phone: "9876500000", priceRupees: 3499, setupFeeRupees: 0, syncClient: true } }), params({ agreementId: a.id })));
    expect(fix.status).toBe(200);
    const v2 = fix.body.agreement as { id: string; version: number; status: string; documents: unknown[] };
    expect(v2.id).not.toBe(a.id);
    expect(v2).toMatchObject({ version: 2, status: "draft" });
    expect(v2.documents).toHaveLength(1);
    expect((await db.clientAgreement.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("superseded");
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).contactPhone).toBe("+919876500000");
  });

  it("admin verifies documents; without an approved template WhatsApp falls back to a manual link", async () => {
    resetRateLimits();
    const { admin, org } = await client();
    actAs(admin);
    await saveProvider({ legalName: "MECGURA", address: "", gstin: "", email: "", phone: "", signatoryName: "", signatoryTitle: "Founder", jurisdiction: "", sendFromAccountId: "" }, admin.id);
    const a = (await json(await orgAgreements.POST(req("/x", { method: "POST" }), params({ id: org.id })))).body.agreement as { id: string; link: string };
    const s = await json(await sendRoute.POST(req("/x", { method: "POST", body: { whatsapp: true, email: false } }), params({ agreementId: a.id })));
    expect((s.body.log as { whatsapp: { sent: boolean }; manualWhatsApp: string }).whatsapp.sent).toBe(false);
    expect((s.body.log as { manualWhatsApp: string }).manualWhatsApp).toContain("wa.me/");

    const token = a.link.split("/").pop()!;
    await pubDocs.POST(uploadReq("udyam", PDF, "application/pdf", "udyam.pdf"), params({ token }));
    const doc = await db.clientDocument.findFirstOrThrow({ where: { agreementId: a.id } });
    const file = await adminDoc.GET(req("/x"), params({ docId: doc.id }));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect((await adminDoc.PATCH(req("/x", { method: "PATCH", body: { status: "verified" } }), params({ docId: doc.id }))).status).toBe(200);
    expect((await db.clientDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("verified");

    // Only a Super Admin can manage agreements.
    const outsider = await makeUser();
    actAs(outsider);
    expect((await orgAgreements.GET(req("/x"), params({ id: org.id }))).status).toBe(403);
    expect((await settingsRoute.GET(req("/x"))).status).toBe(403);
    expect((await adminDoc.GET(req("/x"), params({ docId: doc.id }))).status).toBe(403);
  });

  it("onboarding can create and send the agreement in one step", async () => {
    const admin = await makeUser({ role: "SUPER_ADMIN" });
    const plan = await makePlan({ maxUsers: 3, maxWhatsAppNumbers: 1 });
    actAs(admin);
    const r = await json(
      await clientsRoute.POST(
        req("/x", { method: "POST", body: { name: "Onboard Shop", ownerName: "Simran Kaur", ownerEmail: `simran${Date.now()}@example.com`, ownerPassword: "Str0ngPassw0rd!", mobile: "9812345678", planId: plan.id, sendAgreement: true } }),
        params({})
      )
    );
    expect(r.status).toBe(201);
    expect((r.body.agreement as { email: { sent: boolean } }).email.sent).toBe(true);
    const orgId = (r.body.organization as { id: string }).id;
    const a = await db.clientAgreement.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(a).toMatchObject({ status: "sent", contactName: "Simran Kaur", phone: "+919812345678" });
  });

  it("the client owner can complete it from their own workspace without any link", async () => {
    resetRateLimits();
    const { org, owner } = await client();
    expect(await agreementProgress(org.id)).toEqual({ signed: false, hasProof: false });
    const w = await workspaceAgreement(org.id, owner.id);
    expect(w.agreement.status).toBe("sent");
    // Opening again returns the same agreement.
    expect((await workspaceAgreement(org.id, owner.id)).token).toBe(w.token);
    actAs(null);
    await pubDocs.POST(uploadReq("pan", PDF, "application/pdf", "pan.pdf"), params({ token: w.token }));
    expect(await agreementProgress(org.id)).toEqual({ signed: false, hasProof: true });
    expect((await pubSign.POST(req("/x", { method: "POST", body: { signerName: "Ravi Kumar", accept: true } }), params({ token: w.token }))).status).toBe(200);
    expect(await agreementProgress(org.id)).toEqual({ signed: true, hasProof: true });
  });
});
