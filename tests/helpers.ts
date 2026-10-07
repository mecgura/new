import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { fakeSession } from "./fake-session";
import { resetRateLimits } from "@/lib/rate-limit";

export const BASE = "http://localhost:3000";
let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function makeUser(opts: { role?: string; name?: string; status?: string; password?: string } = {}) {
  return db.user.create({
    data: {
      email: `user-${uid()}@test.local`,
      name: opts.name ?? "Test User",
      passwordHash: await bcrypt.hash(opts.password ?? "Passw0rd!", 4),
      role: opts.role ?? "USER",
      status: opts.status ?? "active",
    },
  });
}

export async function makeOrg(name = "Org") {
  return db.organization.create({ data: { name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${uid()}` } });
}

export async function addMember(organizationId: string, userId: string, role: "CLIENT_OWNER" | "MANAGER" | "AGENT") {
  return db.organizationMember.create({ data: { organizationId, userId, role } });
}

/** Acts as `user` for subsequent handler calls (null = signed out). */
export function actAs(user: { id: string; email: string; role: string; sessionVersion: number } | null) {
  resetRateLimits();
  fakeSession.current = user ? { user: { id: user.id, email: user.email, role: user.role }, sv: user.sessionVersion } : null;
}

export function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:3000", ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export async function json(res: Response) {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let planSeq = 0;
export async function makePlan(overrides: Partial<{ name: string; priceMonthly: number; maxUsers: number; maxWhatsAppNumbers: number; isActive: boolean }> = {}) {
  const n = `${Date.now().toString(36)}${(planSeq++).toString(36)}`;
  return db.plan.create({
    data: {
      name: overrides.name ?? `Plan ${n}`,
      slug: `plan-${n}`,
      priceMonthly: overrides.priceMonthly ?? 199900,
      maxUsers: overrides.maxUsers ?? 5,
      maxWhatsAppNumbers: overrides.maxWhatsAppNumbers ?? 2,
      isActive: overrides.isActive ?? true,
    },
  });
}
