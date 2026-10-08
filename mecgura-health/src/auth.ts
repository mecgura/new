import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { headers } from "next/headers";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { findTenantByHost } from "@/lib/tenant/resolve-core";
import { loginSchema, normalizeIdentifier } from "@/lib/validation/schemas";
import { STAFF_APP_ROLES, type RoleKey } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { authorizePatient, PATIENT_SESSION_MS } from "@/lib/portal/patient-login";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
// Compared against when the account doesn't exist so response time doesn't reveal it.
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), 12);

/**
 * Authentication only: proves WHO the user is. The JWT carries just the user id; role, tenant,
 * status and permissions are re-read from the database on every request (see
 * lib/auth/context.ts) so disabling a user or changing a role takes effect immediately.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 8, updateAge: 60 * 30 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    // Patient portal sign-in: a separate provider so a staff credential form can never produce a patient session or the reverse.
    Credentials({ id: "patient", name: "Patient portal", credentials: { clinic: {}, identifier: {}, password: {} }, authorize: (credentials) => authorizePatient(credentials) }),
    Credentials({
      credentials: { identifier: {}, password: {} },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const id = normalizeIdentifier(parsed.data.identifier)!;
        const { password } = parsed.data;

        const user = await db.user.findFirst({
          where: { ...(id.kind === "email" ? { email: id.value } : { phone: id.value }), deletedAt: null },
          include: { role: { select: { key: true } }, tenant: { select: { id: true, status: true, deletedAt: true } } },
        });

        const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        const now = new Date();
        const locked = !!user?.lockedUntil && user.lockedUntil > now;
        const roleKey = user?.role.key;
        const roleOk = !!user && (STAFF_APP_ROLES as readonly string[]).includes(roleKey!);
        // Tenant users must belong to an ACTIVE/TRIAL clinic; only SUPER_ADMIN may have no clinic.
        const tenantOk = roleKey === "SUPER_ADMIN" ? !user?.tenantId : !!user?.tenant && !user.tenant.deletedAt && TENANT_ACCESS_STATUSES.includes(user.tenant.status);
        // On a clinic's own domain/subdomain only that clinic's users (or Super Admin) may sign in. Read from the
        // request's Host header here — not from client-supplied form fields — so it can't be bypassed.
        const h = await headers();
        const hostTenant = await findTenantByHost(h.get("x-forwarded-host") ?? h.get("host"));
        const hostOk = !hostTenant || roleKey === "SUPER_ADMIN" || user?.tenantId === hostTenant.id;
        const allowed = !!user && !!user.passwordHash && passwordOk && !locked && tenantOk && roleOk && hostOk && user.status === "ACTIVE";

        if (!allowed) {
          if (user && user.passwordHash && !passwordOk && !locked) {
            const failures = user.failedLoginCount + 1;
            await db.user.update({
              where: { id: user.id },
              data: {
                failedLoginCount: failures,
                lockedUntil: failures >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : undefined,
              },
            });
            if (failures === MAX_FAILED_LOGINS && user.tenantId) void import("@/lib/notifications/events").then((m) => m.notifyStaffSecurity(user.tenantId, "locked", user.id, { who: user.name })).catch(() => undefined);
          }
          const reason = !user ? "unknown_account" : locked ? "locked" : !passwordOk || !user.passwordHash ? "bad_password" : user.status !== "ACTIVE" ? `status_${user.status.toLowerCase()}` : !tenantOk ? "tenant_unavailable" : !hostOk ? "wrong_clinic_host" : "not_allowed";
          await recordAudit({ action: AUDIT_ACTIONS.LOGIN_FAILED, tenantId: user?.tenantId ?? null, actorId: user?.id, metadata: { reason } });
          logger.warn("login rejected", { userKnown: !!user, reason });
          return null;
        }

        await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
        await recordAudit({ action: AUDIT_ACTIONS.LOGIN_SUCCEEDED, tenantId: user.tenantId, actorId: user.id, metadata: { role: user.role.key as RoleKey } });
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        // Set ONCE at sign-in: a portal session has a fixed absolute lifetime and a sign-in time that "log out everywhere" can compare.
        if (user.kind === "patient") { token.kind = "patient"; token.sa = Date.now(); token.pexp = token.sa + PATIENT_SESSION_MS; }
        else { delete token.kind; delete token.sa; delete token.pexp; token.sat = Date.now(); }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.uid === "string") session.user.id = token.uid;
      session.signedInAt = token.kind !== "patient" && typeof token.sat === "number" ? token.sat : null;
      session.portal = token.kind === "patient" && typeof token.sa === "number" && typeof token.pexp === "number" ? { sa: token.sa, pexp: token.pexp } : null;
      return session;
    },
  },
});
