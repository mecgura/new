import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { actAs, json, makeUser, req } from "../helpers";
import * as meRoute from "@/app/api/me/route";
import * as passwordRoute from "@/app/api/me/password/route";
import * as profileRoute from "@/app/api/me/profile/route";
import * as sessionsRoute from "@/app/api/me/sessions/route";
import * as forgotRoute from "@/app/api/auth/forgot-password/route";
import * as resetRoute from "@/app/api/auth/reset-password/route";
import * as mailer from "@/lib/mailer";

beforeEach(() => vi.restoreAllMocks());

describe("session validation (server-side, against the DB)", () => {
  it("valid session resolves the user", async () => {
    const u = await makeUser({ name: "Session User" });
    actAs(u);
    expect((await getSessionUser())?.id).toBe(u.id);
    expect((await meRoute.GET(req("/api/me"), {})).status).toBe(200);
  });

  it("no session / invalid session / deleted user / disabled user → 401", async () => {
    actAs(null);
    expect((await meRoute.GET(req("/api/me"), {})).status).toBe(401);

    actAs({ id: "nonexistent", email: "x@x", role: "USER", sessionVersion: 0 });
    expect((await meRoute.GET(req("/api/me"), {})).status).toBe(401);

    const disabled = await makeUser({ status: "disabled" });
    actAs(disabled);
    expect((await meRoute.GET(req("/api/me"), {})).status).toBe(401);
  });

  it("a forged JWT role claim is ignored — the DB role wins", async () => {
    const u = await makeUser();
    actAs({ ...u, role: "SUPER_ADMIN" });
    expect((await getSessionUser())?.platformRole).toBe("USER");
  });
});

describe("password change", () => {
  it("wrong current password → 400, nothing changes", async () => {
    const u = await makeUser();
    actAs(u);
    const res = await json(await passwordRoute.POST(req("/api/me/password", { method: "POST", body: { currentPassword: "wrong", newPassword: "N3wPassword" } }), {}));
    expect(res.status).toBe(400);
    expect((await db.user.findUnique({ where: { id: u.id } }))?.passwordHash).toBe(u.passwordHash);
  });

  it("weak new password → 400", async () => {
    const u = await makeUser();
    actAs(u);
    expect((await passwordRoute.POST(req("/api/me/password", { method: "POST", body: { currentPassword: "Passw0rd!", newPassword: "short" } }), {})).status).toBe(400);
  });

  it("success: hash stored (never plaintext), old sessions revoked", async () => {
    const u = await makeUser();
    actAs(u);
    expect((await passwordRoute.POST(req("/api/me/password", { method: "POST", body: { currentPassword: "Passw0rd!", newPassword: "N3wPassword" } }), {})).status).toBe(200);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.passwordHash).not.toBe("N3wPassword");
    expect(await bcrypt.compare("N3wPassword", after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(u.sessionVersion + 1);
    // Old cookie (old session version) is now rejected.
    expect((await meRoute.GET(req("/api/me"), {})).status).toBe(401);
    expect(await db.auditLog.count({ where: { action: "auth.password_changed", actorUserId: u.id } })).toBe(1);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "auth.password_changed", actorUserId: u.id } });
    expect(log.metadata).not.toContain("N3wPassword");
  });
});

describe("sign out of all devices", () => {
  it("revokes the current session too", async () => {
    const u = await makeUser();
    actAs(u);
    expect((await sessionsRoute.DELETE(req("/api/me/sessions", { method: "DELETE" }), {})).status).toBe(200);
    expect((await meRoute.GET(req("/api/me"), {})).status).toBe(401);
  });
});

describe("profile", () => {
  it("persists the name", async () => {
    const u = await makeUser({ name: "Old Name" });
    actAs(u);
    expect((await profileRoute.PATCH(req("/api/me/profile", { method: "PATCH", body: { name: "New Name" } }), {})).status).toBe(200);
    expect((await db.user.findUnique({ where: { id: u.id } }))?.name).toBe("New Name");
  });
});

describe("forgot / reset password", () => {
  it("same response for unknown and known emails (no enumeration)", async () => {
    const spy = vi.spyOn(mailer, "sendMail").mockResolvedValue({ delivered: true, channel: "dev-log" });
    const u = await makeUser();
    actAs(null);
    const a = await json(await forgotRoute.POST(req("/api/auth/forgot-password", { method: "POST", body: { email: "nobody@nowhere.local" } }), {}));
    const b = await json(await forgotRoute.POST(req("/api/auth/forgot-password", { method: "POST", body: { email: u.email } }), {}));
    expect(a).toEqual(b);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("full reset flow: token is single-use, hashed at rest, and revokes sessions", async () => {
    let mailText = "";
    vi.spyOn(mailer, "sendMail").mockImplementation(async (_to, _s, text) => {
      mailText = text;
      return { delivered: true, channel: "dev-log" };
    });
    const u = await makeUser();
    actAs(null);
    await forgotRoute.POST(req("/api/auth/forgot-password", { method: "POST", body: { email: u.email } }), {});
    const token = /token=([A-Za-z0-9_-]+)/.exec(mailText)?.[1];
    expect(token).toBeTruthy();
    const stored = await db.passwordResetToken.findFirstOrThrow({ where: { userId: u.id } });
    expect(stored.tokenHash).not.toBe(token);

    const ok = await resetRoute.POST(req("/api/auth/reset-password", { method: "POST", body: { token, password: "Res3tPassword" } }), {});
    expect(ok.status).toBe(200);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await bcrypt.compare("Res3tPassword", after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(u.sessionVersion + 1);

    const reuse = await resetRoute.POST(req("/api/auth/reset-password", { method: "POST", body: { token, password: "An0therPassword" } }), {});
    expect(reuse.status).toBe(400);
  });

  it("invalid / expired tokens are rejected", async () => {
    const u = await makeUser();
    const { hashToken } = await import("@/lib/services/accounts");
    const raw = "x".repeat(43);
    await db.passwordResetToken.create({ data: { userId: u.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() - 1000) } });
    actAs(null);
    expect((await resetRoute.POST(req("/x", { method: "POST", body: { token: raw, password: "Passw0rdX" } }), {})).status).toBe(400);
    expect((await resetRoute.POST(req("/x", { method: "POST", body: { token: "y".repeat(43), password: "Passw0rdX" } }), {})).status).toBe(400);
  });

  it("is rate limited", async () => {
    vi.spyOn(mailer, "sendMail").mockResolvedValue({ delivered: true, channel: "dev-log" });
    actAs(null);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await forgotRoute.POST(req("/x", { method: "POST", body: { email: `r${i}@x.local` }, headers: { "x-forwarded-for": "9.9.9.9" } }), {})).status);
    }
    expect(statuses).toContain(429);
  });
});
