import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

// TEMPORARY diagnostic (guarded by CRON_SECRET, returns only booleans/timings — never secrets). Remove after use.
export const maxDuration = 60;
export async function GET(req: Request) {
  const given = new URL(req.url).searchParams.get("k") ?? "";
  const want = process.env.CRON_SECRET ?? "";
  const a = Buffer.from(given), b = Buffer.from(want);
  if (!want || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "not found" }, { status: 404 });
  const out: Record<string, unknown> = {};
  const t = (label: string, t0: number) => (out[label] = Math.round(performance.now() - t0));
  try {
    let t0 = performance.now();
    await db.$queryRaw`SELECT 1`;
    t("select1_ms", t0);
    const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase();
    out.envEmail = email;
    t0 = performance.now();
    const user = await db.user.findUnique({ where: { email } });
    t("findUser_ms", t0);
    out.userFound = Boolean(user);
    if (user) {
      out.role = user.role;
      out.status = user.status;
      out.hashLooksBcrypt = /^\$2[aby]\$\d\d\$/.test(user.passwordHash ?? "");
      t0 = performance.now();
      out.envPasswordMatches = await bcrypt.compare(process.env.SEED_ADMIN_PASSWORD ?? "", user.passwordHash ?? "");
      t("bcrypt_ms", t0);
      t0 = performance.now();
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      t("update_ms", t0);
    }
    t0 = performance.now();
    out.users = await db.user.count();
    t("count_ms", t0);
  } catch (e) {
    out.error = String(e).slice(0, 300);
  }
  return Response.json(out);
}
