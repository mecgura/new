import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { loginSchema } from "@/lib/validation/schemas";
import { STAFF_APP_ROLES, type RoleKey } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

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
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await db.user.findFirst({
          where: { email, deletedAt: null },
          include: { role: { select: { key: true } }, tenant: { select: { id: true, status: true, deletedAt: true } } },
        });

        const hash = user?.passwordHash ?? DUMMY_HASH;
        const passwordOk = await bcrypt.compare(password, hash);
        const now = new Date();
        const locked = !!user?.lockedUntil && user.lockedUntil > now;
        const tenantOk = !user?.tenantId || (user.tenant?.status === "ACTIVE" && !user.tenant.deletedAt);
        const roleOk = !!user && (STAFF_APP_ROLES as readonly string[]).includes(user.role.key);
        const allowed = !!user && passwordOk && !locked && tenantOk && roleOk && user.status === "ACTIVE";

        if (!allowed) {
          if (user && !passwordOk && !locked) {
            const failures = user.failedLoginCount + 1;
            await db.user.update({
              where: { id: user.id },
              data: {
                failedLoginCount: failures,
                lockedUntil: failures >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : undefined,
              },
            });
          }
          await recordAudit({ action: AUDIT_ACTIONS.LOGIN_FAILED, tenantId: user?.tenantId ?? null, actorId: user?.id, metadata: { reason: !user ? "unknown_account" : locked ? "locked" : !passwordOk ? "bad_password" : "not_allowed" } });
          logger.warn("login rejected", { userKnown: !!user });
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
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});
