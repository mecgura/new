import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { siteConfig } from "@/config/site";
import {
  balanceOf,
  codeInText,
  DEFAULT_LOYALTY,
  loyaltySettingsSchema,
  makeCode,
  parseLoyalty,
  pointsForPurchase,
  tierFor,
  type LoyaltySettings,
} from "@/lib/loyalty";
import type { Ctx } from "@/services/inbox/contacts";
import { isServiceEnabled } from "@/services/whatsapp/guards";

/**
 * Referral & loyalty for a client's own customers: purchases earn points (with expiry), points buy rewards from the
 * client's catalogue, lifetime points set the membership tier, and every customer gets a referral link that opens
 * WhatsApp with their code. A referral pays out after the friend's first qualifying purchase, straight away or after
 * an owner approves it, and suspicious ones are flagged instead of paid.
 */

export async function getLoyaltySettings(
  organizationId: string,
): Promise<LoyaltySettings> {
  const s = await db.organizationSettings.findUnique({
    where: { organizationId },
    select: { loyalty: true },
  });
  return parseLoyalty(s?.loyalty);
}

export async function saveLoyaltySettings(ctx: Ctx, input: LoyaltySettings) {
  const json = JSON.stringify(input);
  await db.organizationSettings.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, loyalty: json },
    update: { loyalty: json },
  });
  await audit({
    action: "loyalty.settings_changed",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType: "loyalty",
    metadata: { enabled: input.enabled },
    req: ctx.req,
  });
  return getLoyaltySettings(ctx.organizationId);
}
export { loyaltySettingsSchema, DEFAULT_LOYALTY };

async function requireOn(organizationId: string) {
  const s = await getLoyaltySettings(organizationId);
  if (!s.enabled)
    throw new ApiError(
      "CONFLICT",
      "Turn the loyalty programme on in Loyalty → Settings first.",
    );
  return s;
}

async function contactOf(organizationId: string, contactId: string) {
  const c = await db.contact.findFirst({
    where: { id: contactId, organizationId },
    select: { id: true, name: true, phone: true, createdAt: true },
  });
  if (!c)
    throw new ApiError(
      "VALIDATION_ERROR",
      "Pick a contact from this workspace.",
      { details: { contactId: ["Unknown contact"] } },
    );
  return c;
}

const expiry = (s: LoyaltySettings, from = new Date()) =>
  s.expiryDays ? new Date(from.getTime() + s.expiryDays * 86_400_000) : null;

async function ledger(organizationId: string, contactId: string) {
  return db.loyaltyEntry.findMany({
    where: { organizationId, contactId },
    orderBy: { createdAt: "asc" },
  });
}

/** Balance, tier and pending points for one customer. */
export async function wallet(
  organizationId: string,
  contactId: string,
  s?: LoyaltySettings,
) {
  const settings = s ?? (await getLoyaltySettings(organizationId));
  const entries = await ledger(organizationId, contactId);
  const b = balanceOf(entries);
  return {
    ...b,
    pending: entries
      .filter((e) => e.status === "pending")
      .reduce((a, e) => a + e.points, 0),
    ...tierFor(b.lifetime, settings.tiers),
  };
}

// ---------------------------------------------------------------------------
// Referral codes and links
// ---------------------------------------------------------------------------
export async function referralCodeFor(
  organizationId: string,
  contactId: string,
) {
  const existing = await db.referralCode.findUnique({ where: { contactId } });
  if (existing) return existing.code;
  for (let i = 0; i < 8; i++) {
    const code = makeCode();
    try {
      await db.referralCode.create({
        data: { organizationId, contactId, code },
      });
      return code;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        const again = await db.referralCode.findUnique({
          where: { contactId },
        });
        if (again) return again.code; // created by a parallel request
        continue; // code clash: try another
      }
      throw e;
    }
  }
  throw new ApiError(
    "SERVICE_UNAVAILABLE",
    "Couldn't create a referral code. Please try again.",
  );
}

export const referralLink = (organizationId: string, code: string) =>
  `${siteConfig.url}/r/${organizationId}/${code}`;
export const referralMessage = (code: string) =>
  `Hi! My friend referred me to you. My code is REF-${code}`;

/** Where a referral link goes: the client's WhatsApp with the code typed in, or null if they have no number. */
export async function referralTarget(organizationId: string, code: string) {
  if (
    !/^[A-Z0-9]{6}$/.test(code) ||
    !(await isServiceEnabled(organizationId, "LOYALTY")) ||
    !(await getLoyaltySettings(organizationId)).enabled
  )
    return null;
  const rc = await db.referralCode.findUnique({
    where: { organizationId_code: { organizationId, code } },
    select: { code: true },
  });
  if (!rc) return null;
  const acct = await db.whatsAppAccount.findFirst({
    where: { organizationId, status: { in: ["connected", "demo"] } },
    orderBy: { createdAt: "asc" },
    select: { phoneNumber: true },
  });
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (!acct || !org) return null;
  return {
    business: org.name,
    url: `https://wa.me/${acct.phoneNumber.replace(/\D/g, "")}?text=${encodeURIComponent(referralMessage(code))}`,
  };
}

/**
 * A customer's first WhatsApp message carried a referral code: record who referred them. Never throws (it runs inside
 * message receipt). Flags instead of paying when it looks wrong: their own code, an existing customer, or a burst.
 */
export async function captureReferral(
  organizationId: string,
  refereeContactId: string,
  text: string,
) {
  try {
    const code = codeInText(text);
    if (!code) return null;
    const settings = await getLoyaltySettings(organizationId);
    if (
      !settings.enabled ||
      !(await isServiceEnabled(organizationId, "LOYALTY"))
    )
      return null;
    const rc = await db.referralCode.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
    if (!rc || rc.contactId === refereeContactId) return null;
    const referee = await db.contact.findUnique({
      where: { id: refereeContactId },
      select: { createdAt: true, _count: { select: { purchases: true } } },
    });
    if (!referee) return null;
    const flags: string[] = [];
    if (
      Date.now() - referee.createdAt.getTime() > 10 * 60_000 ||
      referee._count.purchases
    )
      flags.push("Was already a contact before this referral");
    const lastDay = await db.referral.count({
      where: {
        organizationId,
        referrerContactId: rc.contactId,
        createdAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    });
    if (lastDay >= 10) flags.push("Referrer brought 10+ people in 24 hours");
    return await db.referral.create({
      data: {
        organizationId,
        referrerContactId: rc.contactId,
        refereeContactId,
        code,
        flag: flags.join("; "),
      },
    });
  } catch (e) {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    )
      console.error("[loyalty] referral not recorded:", e);
    return null;
  }
}

async function payReferral(
  organizationId: string,
  referralId: string,
  status: "approved" | "pending",
  actorId: string | null,
  s: LoyaltySettings,
) {
  const r = await db.referral.findUniqueOrThrow({ where: { id: referralId } });
  const exp = expiry(s);
  const rows = [
    s.referrerPoints
      ? {
          contactId: r.referrerContactId,
          points: s.referrerPoints,
          note: "Referral reward: a friend you referred made a purchase",
        }
      : null,
    s.refereePoints
      ? {
          contactId: r.refereeContactId,
          points: s.refereePoints,
          note: "Welcome reward for joining through a referral",
        }
      : null,
  ].filter(Boolean) as { contactId: string; points: number; note: string }[];
  await db.$transaction([
    ...rows.map((x) =>
      db.loyaltyEntry.create({
        data: {
          organizationId,
          ...x,
          kind: "referral",
          status,
          refType: "referral",
          refId: r.id,
          expiresAt: exp,
          actorId,
        },
      }),
    ),
    db.referral.update({
      where: { id: r.id },
      data: {
        status: status === "approved" ? "rewarded" : "qualified",
        qualifiedAt: new Date(),
      },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Purchases, redemptions, adjustments
// ---------------------------------------------------------------------------
export const purchaseSchema = z
  .object({
    contactId: z.string().min(1).max(40),
    amountRupees: z.coerce.number().positive().max(100_000_000),
    note: z.string().trim().max(200).default(""),
  })
  .strict();

export async function recordPurchase(
  ctx: Ctx,
  input: z.infer<typeof purchaseSchema>,
) {
  const s = await requireOn(ctx.organizationId);
  await contactOf(ctx.organizationId, input.contactId);
  const amountPaise = Math.round(input.amountRupees * 100);
  const first = !(await db.purchase.count({
    where: { organizationId: ctx.organizationId, contactId: input.contactId },
  }));
  const purchase = await db.purchase.create({
    data: {
      organizationId: ctx.organizationId,
      contactId: input.contactId,
      amountPaise,
      note: input.note,
      actorId: ctx.actorUserId,
    },
  });
  const points = pointsForPurchase(amountPaise, s);
  const exp = expiry(s);
  if (points)
    await db.loyaltyEntry.create({
      data: {
        organizationId: ctx.organizationId,
        contactId: input.contactId,
        points,
        kind: "purchase",
        refType: "purchase",
        refId: purchase.id,
        note: `₹${input.amountRupees.toLocaleString("en-IN")} purchase${input.note ? ` · ${input.note}` : ""}`,
        expiresAt: exp,
        actorId: ctx.actorUserId,
      },
    });
  if (first && s.welcomePoints)
    await db.loyaltyEntry.create({
      data: {
        organizationId: ctx.organizationId,
        contactId: input.contactId,
        points: s.welcomePoints,
        kind: "welcome",
        note: "Welcome to the loyalty programme",
        expiresAt: exp,
        actorId: ctx.actorUserId,
      },
    });
  // First qualifying purchase of a referred customer pays the referral.
  let referral: string | null = null;
  const ref = await db.referral.findFirst({
    where: {
      organizationId: ctx.organizationId,
      refereeContactId: input.contactId,
      status: "pending",
    },
  });
  if (ref && amountPaise >= s.referralMinPurchaseRupees * 100) {
    const auto = s.referralApproval === "auto" && !ref.flag;
    await payReferral(
      ctx.organizationId,
      ref.id,
      auto ? "approved" : "pending",
      ctx.actorUserId,
      s,
    );
    referral = auto ? "rewarded" : "waiting_approval";
  }
  // Becomes a customer on their first purchase.
  await db.contact.update({
    where: { id: input.contactId },
    data: { lifecycle: "customer" },
  });
  await audit({
    action: "loyalty.purchase_recorded",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType: "contact",
    targetId: input.contactId,
    metadata: { amountPaise, points },
    req: ctx.req,
  });
  return {
    purchaseId: purchase.id,
    points,
    referral,
    wallet: await wallet(ctx.organizationId, input.contactId, s),
  };
}

export const redeemSchema = z
  .object({
    contactId: z.string().min(1).max(40),
    rewardId: z.string().max(40).optional(),
    points: z.coerce.number().int().positive().max(10_000_000).optional(),
    note: z.string().trim().max(200).default(""),
  })
  .strict()
  .refine((v) => v.rewardId || v.points, {
    message: "Pick a reward or enter points",
    path: ["rewardId"],
  });

/** Spends points (on a catalogue reward or a custom amount). Serializable so two redemptions can't overdraw. */
export async function redeem(ctx: Ctx, input: z.infer<typeof redeemSchema>) {
  await requireOn(ctx.organizationId);
  await contactOf(ctx.organizationId, input.contactId);
  let points = input.points ?? 0;
  let label = input.note || "Points redeemed";
  if (input.rewardId) {
    const r = await db.loyaltyReward.findFirst({
      where: {
        id: input.rewardId,
        organizationId: ctx.organizationId,
        active: true,
      },
    });
    if (!r)
      throw new ApiError("VALIDATION_ERROR", "That reward isn't available.", {
        details: { rewardId: ["Unknown reward"] },
      });
    points = r.points;
    label = `Redeemed: ${r.name}${input.note ? ` · ${input.note}` : ""}`;
  }
  await db
    .$transaction(
      async (tx) => {
        const entries = await tx.loyaltyEntry.findMany({
          where: {
            organizationId: ctx.organizationId,
            contactId: input.contactId,
          },
        });
        const { balance } = balanceOf(entries);
        if (balance < points)
          throw new ApiError(
            "CONFLICT",
            `Not enough points: ${balance} available, ${points} needed.`,
          );
        await tx.loyaltyEntry.create({
          data: {
            organizationId: ctx.organizationId,
            contactId: input.contactId,
            points: -points,
            kind: "redeem",
            refType: input.rewardId ? "reward" : "",
            refId: input.rewardId ?? "",
            note: label,
            actorId: ctx.actorUserId,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((e: unknown) => {
      // Two redemptions at the same moment: one wins, the other is asked to retry instead of overdrawing.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2034"
      )
        throw new ApiError(
          "CONFLICT",
          "Another redemption was just made for this customer. Please try again.",
        );
      throw e;
    });
  await audit({
    action: "loyalty.points_changed",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType: "contact",
    targetId: input.contactId,
    metadata: { points: -points, rewardId: input.rewardId },
    req: ctx.req,
  });
  return wallet(ctx.organizationId, input.contactId);
}

export const adjustSchema = z
  .object({
    contactId: z.string().min(1).max(40),
    points: z.coerce
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((n) => n !== 0, "Enter points to add or remove"),
    note: z.string().trim().min(3, "Say why").max(200),
  })
  .strict();

export async function adjust(ctx: Ctx, input: z.infer<typeof adjustSchema>) {
  const s = await requireOn(ctx.organizationId);
  await contactOf(ctx.organizationId, input.contactId);
  if (input.points < 0) {
    const { balance } = await wallet(ctx.organizationId, input.contactId, s);
    if (balance + input.points < 0)
      throw new ApiError(
        "CONFLICT",
        `Can't remove more than the ${balance} points they have.`,
      );
  }
  await db.loyaltyEntry.create({
    data: {
      organizationId: ctx.organizationId,
      contactId: input.contactId,
      points: input.points,
      kind: "adjust",
      note: input.note,
      expiresAt: input.points > 0 ? expiry(s) : null,
      actorId: ctx.actorUserId,
    },
  });
  await audit({
    action: "loyalty.points_changed",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType: "contact",
    targetId: input.contactId,
    metadata: { points: input.points },
    req: ctx.req,
  });
  return wallet(ctx.organizationId, input.contactId, s);
}

// ---------------------------------------------------------------------------
// Rewards catalogue
// ---------------------------------------------------------------------------
export const rewardSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).default(""),
    points: z.coerce.number().int().min(1).max(10_000_000),
    active: z.boolean().default(true),
  })
  .strict();

export async function listRewards(organizationId: string, activeOnly = false) {
  return db.loyaltyReward.findMany({
    where: { organizationId, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ active: "desc" }, { points: "asc" }],
  });
}
export async function saveReward(
  ctx: Ctx,
  id: string | null,
  input: z.infer<typeof rewardSchema>,
) {
  if (id) {
    const r = await db.loyaltyReward.updateMany({
      where: { id, organizationId: ctx.organizationId },
      data: input,
    });
    if (!r.count) throw new ApiError("NOT_FOUND", "Reward not found.");
  } else {
    if (
      (await db.loyaltyReward.count({
        where: { organizationId: ctx.organizationId },
      })) >= 50
    )
      throw new ApiError("CONFLICT", "Up to 50 rewards.");
    id = (
      await db.loyaltyReward.create({
        data: { ...input, organizationId: ctx.organizationId },
      })
    ).id;
  }
  await audit({
    action: "loyalty.reward_saved",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType: "loyalty_reward",
    targetId: id,
    req: ctx.req,
  });
  return db.loyaltyReward.findUniqueOrThrow({ where: { id } });
}

// ---------------------------------------------------------------------------
// Referrals review
// ---------------------------------------------------------------------------
export const referralListSchema = z.object({
  status: z.enum(["pending", "qualified", "rewarded", "rejected"]).optional(),
});

export async function listReferrals(
  organizationId: string,
  q: z.infer<typeof referralListSchema>,
) {
  const rows = await db.referral.findMany({
    where: { organizationId, ...(q.status ? { status: q.status } : {}) },
    include: {
      referrer: { select: { id: true, name: true, phone: true } },
      referee: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows;
}

export async function decideReferral(
  ctx: Ctx,
  id: string,
  decision: "approve" | "reject",
) {
  const r = await db.referral.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!r) throw new ApiError("NOT_FOUND", "Referral not found.");
  if (r.status === "rewarded" || r.status === "rejected")
    throw new ApiError("CONFLICT", "This referral is already decided.");
  const s = await requireOn(ctx.organizationId);
  if (decision === "reject") {
    await db.$transaction([
      db.referral.update({ where: { id }, data: { status: "rejected" } }),
      db.loyaltyEntry.updateMany({
        where: {
          organizationId: ctx.organizationId,
          refType: "referral",
          refId: id,
          status: "pending",
        },
        data: { status: "rejected" },
      }),
    ]);
  } else if (r.status === "qualified") {
    await db.$transaction([
      db.referral.update({ where: { id }, data: { status: "rewarded" } }),
      db.loyaltyEntry.updateMany({
        where: {
          organizationId: ctx.organizationId,
          refType: "referral",
          refId: id,
          status: "pending",
        },
        data: { status: "approved" },
      }),
    ]);
  } else {
    // Approving before the friend has bought: pay now (owner's call).
    await payReferral(ctx.organizationId, id, "approved", ctx.actorUserId, s);
  }
  await audit({
    action: "loyalty.referral_decided",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType: "referral",
    targetId: id,
    metadata: { decision },
    req: ctx.req,
  });
  return db.referral.findUniqueOrThrow({ where: { id } });
}

// ---------------------------------------------------------------------------
// Customers and overview
// ---------------------------------------------------------------------------
/** One customer's loyalty card: balance, tier, history, purchases, lifetime value and referral link. */
export async function customerCard(organizationId: string, contactId: string) {
  const c = await contactOf(organizationId, contactId);
  const s = await getLoyaltySettings(organizationId);
  const [w, entries, purchases, made, code] = await Promise.all([
    wallet(organizationId, contactId, s),
    db.loyaltyEntry.findMany({
      where: { organizationId, contactId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.purchase.findMany({
      where: { organizationId, contactId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.referral.findMany({
      where: { organizationId, referrerContactId: contactId },
      include: { referee: { select: { name: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    s.enabled
      ? referralCodeFor(organizationId, contactId)
      : Promise.resolve(null),
  ]);
  const spentPaise = purchases.reduce((a, p) => a + p.amountPaise, 0);
  const gaps = purchases
    .slice(0, -1)
    .map(
      (p, i) =>
        (p.createdAt.getTime() - purchases[i + 1].createdAt.getTime()) /
        86_400_000,
    );
  return {
    contact: c,
    wallet: w,
    history: entries,
    purchases,
    referrals: made,
    lifetimeValueRupees: spentPaise / 100,
    purchaseCount: purchases.length,
    avgOrderRupees: purchases.length
      ? Math.round(spentPaise / purchases.length) / 100
      : 0,
    avgDaysBetween: gaps.length
      ? Math.round(gaps.reduce((a, g) => a + g, 0) / gaps.length)
      : null,
    lastPurchaseAt: purchases[0]?.createdAt ?? null,
    referral: code
      ? {
          code,
          link: referralLink(organizationId, code),
          message: referralMessage(code),
        }
      : null,
  };
}

export const membersQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
});

/** Customers in the programme (anyone with points or a purchase), with balances and tiers. */
export async function listMembers(
  organizationId: string,
  q: z.infer<typeof membersQuerySchema>,
) {
  const s = await getLoyaltySettings(organizationId);
  const term = q.q?.trim();
  const contacts = await db.contact.findMany({
    where: {
      organizationId,
      OR: [{ loyaltyEntries: { some: {} } }, { purchases: { some: {} } }],
      ...(term
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: term } },
                  { phone: { contains: term } },
                ],
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      loyaltyEntries: {
        select: {
          points: true,
          status: true,
          createdAt: true,
          expiresAt: true,
        },
      },
      purchases: { select: { amountPaise: true, createdAt: true } },
    },
    take: 300,
  });
  return contacts
    .map((c) => {
      const b = balanceOf(c.loyaltyEntries);
      const last = c.purchases.reduce<Date | null>(
        (a, p) => (!a || p.createdAt > a ? p.createdAt : a),
        null,
      );
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        balance: b.balance,
        lifetime: b.lifetime,
        expiringSoon: b.expiringSoon,
        tier: tierFor(b.lifetime, s.tiers).tier,
        purchases: c.purchases.length,
        spentRupees: c.purchases.reduce((a, p) => a + p.amountPaise, 0) / 100,
        lastPurchaseAt: last,
      };
    })
    .sort((a, b) => b.spentRupees - a.spentRupees);
}

/** Programme numbers for the last 30 days plus totals. */
export async function loyaltyOverview(
  organizationId: string,
  now = new Date(),
) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [
    settings,
    issued,
    redeemed,
    purchases30,
    buyers,
    repeat,
    refs,
    members,
  ] = await Promise.all([
    getLoyaltySettings(organizationId),
    db.loyaltyEntry.aggregate({
      where: {
        organizationId,
        status: "approved",
        points: { gt: 0 },
        createdAt: { gte: since },
      },
      _sum: { points: true },
    }),
    db.loyaltyEntry.aggregate({
      where: { organizationId, kind: "redeem", createdAt: { gte: since } },
      _sum: { points: true },
    }),
    db.purchase.aggregate({
      where: { organizationId, createdAt: { gte: since } },
      _sum: { amountPaise: true },
      _count: { _all: true },
    }),
    db.purchase.groupBy({ by: ["contactId"], where: { organizationId } }),
    db.purchase.groupBy({
      by: ["contactId"],
      where: { organizationId },
      having: { contactId: { _count: { gt: 1 } } },
    }),
    db.referral.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: { _all: true },
    }),
    listMembers(organizationId, {}),
  ]);
  const ref = (st: string) =>
    refs.find((r) => r.status === st)?._count._all ?? 0;
  return {
    enabled: settings.enabled,
    members: members.length,
    pointsIssued30: issued._sum.points ?? 0,
    pointsRedeemed30: -(redeemed._sum.points ?? 0),
    outstandingPoints: members.reduce((a, m) => a + m.balance, 0),
    expiringSoon: members.reduce((a, m) => a + m.expiringSoon, 0),
    sales30Rupees: (purchases30._sum.amountPaise ?? 0) / 100,
    purchases30: purchases30._count._all,
    repeatRate: buyers.length
      ? Math.round((repeat.length / buyers.length) * 100)
      : null,
    referrals: {
      pending: ref("pending"),
      waiting: ref("qualified"),
      rewarded: ref("rewarded"),
      rejected: ref("rejected"),
    },
    flagged: await db.referral.count({
      where: {
        organizationId,
        flag: { not: "" },
        status: { in: ["pending", "qualified"] },
      },
    }),
    // Customers who bought before but not in 60 days: the win-back list.
    lapsed: members.filter(
      (m) =>
        m.lastPurchaseAt &&
        now.getTime() - m.lastPurchaseAt.getTime() > 60 * 86_400_000,
    ).length,
  };
}
