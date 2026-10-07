import bcrypt from "bcryptjs";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { loginSchema } from "@/lib/validations";
import { normalizePlatformRole } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

// Compared against when the email is unknown so response timing doesn't
// reveal which accounts exist.
const DUMMY_HASH = "$2b$12$gKSHsqm6m78tuAvpP23HWeitBWHdnR7l6acdTXUkJPKIRI4kesVGC";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase().trim();
        const ip = (request?.headers?.get("x-forwarded-for")?.split(",")[0] ?? "").trim();

        // 10 attempts / 15 min per email+IP, 50 / 15 min per IP.
        const perAccount = rateLimit(`login:${email}:${ip}`, 10, 15 * 60_000);
        const perIp = rateLimit(`login-ip:${ip}`, 50, 15 * 60_000);
        if (!perAccount.allowed || !perIp.allowed) throw new RateLimitedSignin();

        const user = await db.user.findUnique({ where: { email } });
        const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !ok || user.status !== "active") {
          await audit({
            action: "auth.login_failed",
            actorUserId: user?.id ?? null,
            targetType: "user",
            metadata: { reason: !user ? "unknown_account" : !ok ? "bad_password" : "account_disabled" },
            req: request,
          });
          return null;
        }

        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await audit({ action: "auth.login", actorUserId: user.id, targetType: "user", targetId: user.id, req: request });
        return {
          id: user.id,
          name: user.name ?? user.email,
          email: user.email,
          role: normalizePlatformRole(user.role),
          sv: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = normalizePlatformRole((user as { role?: string }).role);
        token.sv = (user as { sv?: number }).sv ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = normalizePlatformRole(token.role as string);
      }
      (session as { sv?: number }).sv = (token.sv as number) ?? 0;
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const userId = (token?.id as string | undefined) ?? null;
      if (userId) await audit({ action: "auth.logout", actorUserId: userId, targetType: "user", targetId: userId });
    },
  },
});
