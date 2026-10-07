import { startBilling } from "@/services/billing/billing";
import { limitLabel, wouldExceed } from "@/lib/plans";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { slugify } from "@/lib/server";
import { isSuperAdmin } from "@/lib/authz";
import { SERVICE_KEYS, type ServiceKey, ACTIVE_NUMBER_STATUSES } from "@/lib/catalog";
import { hashPassword } from "@/lib/services/accounts";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name).slice(0, 48) || "client";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await db.organization.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Readable, policy-compliant temporary password (letters + digits). */
export function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  return `${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}7a`;
}

/** Default rows every client must have; idempotent (safe to re-run as a backfill). */
export async function ensureClientDefaults(organizationId: string, tx: Tx | typeof db = db, enabled: ServiceKey[] = []) {
  await tx.organizationSettings.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
  for (const service of SERVICE_KEYS) {
    await tx.organizationService.upsert({
      where: { organizationId_service: { organizationId, service } },
      update: {},
      create: { organizationId, service, enabled: enabled.includes(service) },
    });
  }
}

export type CreateClientInput = {
  name: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  mobile?: string;
  planId?: string;
  status?: "active" | "suspended";
  services?: ServiceKey[];
};

/**
 * SUPER_ADMIN onboarding. One transaction creates: organization, owner user
 * (or reuses an existing account), CLIENT_OWNER membership, plan subscription,
 * default settings and service flags. Audit + notification follow.
 */
export async function createClient(actorUserId: string, input: CreateClientInput, req?: Request) {
  const plan = input.planId ? await db.plan.findUnique({ where: { id: input.planId } }) : null;
  if (input.planId && (!plan || !plan.isActive)) {
    throw new ApiError("VALIDATION_ERROR", "Select an active plan.", { details: { planId: ["Select an active plan"] } });
  }
  const existing = await db.user.findUnique({ where: { email: input.ownerEmail }, select: { id: true, role: true } });
  if (existing && isSuperAdmin(existing.role)) {
    throw new ApiError("CONFLICT", "A platform administrator account can't be made a client owner.");
  }
  const slug = await uniqueSlug(input.name);
  const passwordHash = existing ? null : await hashPassword(input.ownerPassword);
  const services = input.services ?? [];

  const result = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: input.name, slug, status: input.status ?? "active", contactEmail: input.ownerEmail, contactPhone: input.mobile ?? "" },
    });
    let ownerId = existing?.id;
    if (!ownerId) {
      ownerId = (await tx.user.create({ data: { email: input.ownerEmail, name: input.ownerName, passwordHash: passwordHash!, role: "USER" } })).id;
    }
    await tx.organizationMember.create({ data: { organizationId: organization.id, userId: ownerId, role: "CLIENT_OWNER" } });
    if (plan) {
      await tx.subscription.create({ data: { organizationId: organization.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
    }
    await ensureClientDefaults(organization.id, tx, services);
    return { organization, ownerId, createdUser: !existing };
  });

  const { organization, ownerId, createdUser } = result;
  const orgId = organization.id;
  await audit({ action: "client.created", actorUserId, organizationId: orgId, targetType: "organization", targetId: orgId, metadata: { name: organization.name, slug, status: organization.status, plan: plan?.slug ?? null, services }, req });
  if (createdUser) {
    await audit({ action: "user.created", actorUserId, organizationId: orgId, targetType: "user", targetId: ownerId, metadata: { email: input.ownerEmail, role: "CLIENT_OWNER" }, req });
  }
  if (plan) await audit({ action: "plan.changed", actorUserId, organizationId: orgId, targetType: "plan", targetId: plan.id, metadata: { from: null, to: plan.slug }, req });
  for (const s of services) await audit({ action: "service.enabled", actorUserId, organizationId: orgId, targetType: "service", targetId: s, req });
  await notify({ userId: ownerId, organizationId: orgId, type: "success", title: `Welcome to MECGURA, ${organization.name}`, body: "Your workspace is ready. Complete your profile and invite your team.", link: "/dashboard" });
  return { organization, ownerId, createdUser };
}

export async function updateClient(
  actorUserId: string,
  organizationId: string,
  input: { name?: string; contactEmail?: string; contactPhone?: string },
  req?: Request
) {
  const before = await db.organization.findUnique({ where: { id: organizationId } });
  if (!before) throw new ApiError("NOT_FOUND", "Client not found.");
  const organization = await db.organization.update({ where: { id: organizationId }, data: input });
  const fields = Object.keys(input).filter((k) => input[k as keyof typeof input] !== before[k as keyof typeof before]);
  if (fields.length) await audit({ action: "client.updated", actorUserId, organizationId, targetType: "organization", targetId: organizationId, metadata: { fields }, req });
  return organization;
}

export async function setClientStatus(actorUserId: string, organizationId: string, status: "active" | "suspended", req?: Request) {
  const before = await db.organization.findUnique({ where: { id: organizationId } });
  if (!before) throw new ApiError("NOT_FOUND", "Client not found.");
  if (before.status === status) return before;
  const organization = await db.organization.update({ where: { id: organizationId }, data: { status } });
  await audit({ action: status === "suspended" ? "client.suspended" : "client.activated", actorUserId, organizationId, targetType: "organization", targetId: organizationId, metadata: { from: before.status, to: status }, req });
  return organization;
}

/** Plan change keeps history: the active subscription is ended and a new one starts. */
export async function assignPlan(actorUserId: string, organizationId: string, planId: string, req?: Request, billingMode: "complimentary" | "invoiced" = "complimentary") {
  const [org, plan, current] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId } }),
    db.plan.findUnique({ where: { id: planId } }),
    db.subscription.findFirst({ where: { organizationId, status: "active" }, include: { plan: true } }),
  ]);
  if (!org) throw new ApiError("NOT_FOUND", "Client not found.");
  if (!plan || !plan.isActive) throw new ApiError("VALIDATION_ERROR", "Select an active plan.", { details: { planId: ["Select an active plan"] } });
  if (current?.planId === planId) return current;

  const seats = await db.organizationMember.count({ where: { organizationId } });
  const numbers = await db.whatsAppAccount.count({ where: { organizationId, status: { in: ACTIVE_NUMBER_STATUSES } } });
  if (wouldExceed(seats, plan.maxUsers, 0) || wouldExceed(numbers, plan.maxWhatsAppNumbers, 0)) {
    throw new ApiError("CONFLICT", `${org.name} uses ${seats} seats and ${numbers} WhatsApp number(s); the ${plan.name} plan allows ${limitLabel(plan.maxUsers)} and ${limitLabel(plan.maxWhatsAppNumbers)}. Remove some first.`);
  }

  const now = new Date();
  const sub = await db.$transaction(async (tx) => {
    await tx.subscription.updateMany({ where: { organizationId, status: "active" }, data: { status: "ended", endedAt: now, endReason: "replaced" } });
    return tx.subscription.create({ data: { organizationId, planId, priceMonthly: plan.priceMonthly, startedAt: now }, include: { plan: true } });
  });
  await startBilling(sub, plan, billingMode);
  await audit({ action: "plan.changed", actorUserId, organizationId, targetType: "plan", targetId: planId, metadata: { from: current?.plan.slug ?? null, to: plan.slug }, req });
  const owners = await db.organizationMember.findMany({ where: { organizationId, role: "CLIENT_OWNER" }, select: { userId: true } });
  for (const o of owners) await notify({ userId: o.userId, organizationId, title: `Your plan is now ${plan.name}`, link: "/dashboard" });
  return sub;
}

export async function setServices(actorUserId: string, organizationId: string, changes: Partial<Record<ServiceKey, boolean>>, req?: Request) {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) throw new ApiError("NOT_FOUND", "Client not found.");
  await ensureClientDefaults(organizationId);
  const current = await db.organizationService.findMany({ where: { organizationId } });
  for (const [service, enabled] of Object.entries(changes) as [ServiceKey, boolean][]) {
    const row = current.find((r) => r.service === service);
    if (row?.enabled === enabled) continue;
    await db.organizationService.update({ where: { organizationId_service: { organizationId, service } }, data: { enabled } });
    await audit({ action: enabled ? "service.enabled" : "service.disabled", actorUserId, organizationId, targetType: "service", targetId: service, req });
  }
  return db.organizationService.findMany({ where: { organizationId }, orderBy: { service: "asc" } });
}

/**
 * Resets a member's password (defaults to the first owner) and revokes their
 * sessions. Returns the generated password ONCE; it is never stored in clear.
 */
export async function resetClientAccess(
  actorUserId: string,
  organizationId: string,
  input: { userId?: string; password?: string },
  req?: Request
) {
  const member = input.userId
    ? await db.organizationMember.findFirst({ where: { organizationId, userId: input.userId }, include: { user: true } })
    : await db.organizationMember.findFirst({ where: { organizationId, role: "CLIENT_OWNER" }, orderBy: { createdAt: "asc" }, include: { user: true } });
  if (!member) throw new ApiError("NOT_FOUND", "That user is not a member of this client.");
  if (isSuperAdmin(member.user.role)) throw new ApiError("FORBIDDEN", "Platform administrator accounts can't be reset from a client.");
  const password = input.password ?? generatePassword();
  await db.user.update({
    where: { id: member.userId },
    data: { passwordHash: await hashPassword(password), sessionVersion: { increment: 1 }, status: "active" },
  });
  await audit({ action: "client.access_reset", actorUserId, organizationId, targetType: "user", targetId: member.userId, metadata: { email: member.user.email }, req });
  await notify({ userId: member.userId, organizationId, type: "security", title: "Your password was reset by MECGURA support", body: "All previous sessions were signed out.", link: "/settings/security" });
  return { email: member.user.email, password: input.password ? null : password };
}

/** Deletes a client and every account that belonged ONLY to it. Requires the exact company name. */
export async function deleteClient(actorUserId: string, organizationId: string, confirmName: string, req?: Request) {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: { members: { include: { user: { select: { id: true, email: true, role: true, _count: { select: { memberships: true } } } } } } },
  });
  if (!org) throw new ApiError("NOT_FOUND", "Client not found.");
  if (confirmName.trim() !== org.name) {
    throw new ApiError("VALIDATION_ERROR", "Type the company name exactly to confirm.", { details: { confirmName: ["Doesn't match the company name"] } });
  }
  const exclusiveUsers = org.members.filter((m) => m.user._count.memberships === 1 && !isSuperAdmin(m.user.role)).map((m) => m.user);
  await db.$transaction([
    db.organization.delete({ where: { id: organizationId } }),
    db.user.deleteMany({ where: { id: { in: exclusiveUsers.map((u) => u.id) } } }),
  ]);
  for (const u of exclusiveUsers) {
    await audit({ action: "user.deleted", actorUserId, targetType: "user", targetId: u.id, metadata: { email: u.email, reason: "client_deleted", client: org.name }, req });
  }
  await audit({ action: "client.deleted", actorUserId, targetType: "organization", targetId: organizationId, metadata: { name: org.name, slug: org.slug, usersDeleted: exclusiveUsers.length }, req });
  return { usersDeleted: exclusiveUsers.length };
}

/** Platform-level user deletion with safety rails. */
export async function deleteUser(actorUserId: string, userId: string, req?: Request) {
  if (userId === actorUserId) throw new ApiError("CONFLICT", "You can't delete your own account.");
  const user = await db.user.findUnique({ where: { id: userId }, include: { memberships: { include: { organization: { select: { name: true } } } } } });
  if (!user) throw new ApiError("NOT_FOUND", "User not found.");
  if (isSuperAdmin(user.role)) throw new ApiError("FORBIDDEN", "Platform administrator accounts can't be deleted here.");
  for (const m of user.memberships.filter((m) => m.role === "CLIENT_OWNER")) {
    const owners = await db.organizationMember.count({ where: { organizationId: m.organizationId, role: "CLIENT_OWNER" } });
    if (owners <= 1) throw new ApiError("CONFLICT", `${user.email} is the only owner of ${m.organization.name}. Assign another owner first.`);
  }
  await db.user.delete({ where: { id: userId } });
  await audit({ action: "user.deleted", actorUserId, targetType: "user", targetId: userId, metadata: { email: user.email, organizations: user.memberships.map((m) => m.organizationId) }, req });
}

/** MRR (paise) from active subscriptions of active clients at a point in time. */
export async function mrrAt(at: Date): Promise<number> {
  const subs = await db.subscription.findMany({
    where: { startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }] },
    select: { priceMonthly: true, organization: { select: { status: true } } },
  });
  return subs.filter((s) => s.organization.status === "active").reduce((sum, s) => sum + s.priceMonthly, 0);
}
