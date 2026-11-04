import { providerHealth } from "@/providers/ai/router";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * Service health for the Super Admin: is each provider configured and working, is the scheduler ticking, are
 * webhooks, automations, campaigns and messages failing, how fast and healthy is the public API. Checks that go
 * "down" alert every Super Admin (at most once an hour per check). Only reads counts and configuration; it never
 * calls paid provider APIs.
 */

export type CheckStatus = "ok" | "warn" | "down" | "config";
export type Check = { key: string; group: string; label: string; status: CheckStatus; detail: string };

const has = (...keys: string[]) => keys.every((k) => Boolean(process.env[k]));
const ago = (d: Date | null | undefined, now: number) => (d ? Math.round((now - d.getTime()) / 60_000) : null);
const mins = (m: number | null) => (m === null ? "never" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export async function systemHealth(now = new Date()) {
  const t = now.getTime();
  const day = new Date(t - 86_400_000);
  const dbStart = Date.now();
  await db.$queryRaw`SELECT 1`;
  const dbMs = Date.now() - dbStart;

  const [tick, lastMeta, metaFailed, numbers, redNumbers, msgs, msgFailed, hooksFailed, hooksBacklog, autoFailed, autoStuck, campFailed, campSent, api, api5xx, durations, openTickets, breached] = await Promise.all([
    db.siteSetting.findUnique({ where: { key: "scheduler:lastTick" }, select: { updatedAt: true } }),
    db.webhookEvent.findFirst({ where: { provider: "meta" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    db.webhookEvent.count({ where: { status: "failed", receivedAt: { gte: day } } }),
    db.whatsAppAccount.groupBy({ by: ["status"], _count: { _all: true } }),
    db.phoneNumber.count({ where: { qualityRating: "RED" } }).catch(() => 0),
    db.message.count({ where: { direction: "outbound", createdAt: { gte: day }, isDemo: false } }),
    db.message.count({ where: { direction: "outbound", status: "failed", createdAt: { gte: day }, isDemo: false } }),
    db.webhookDelivery.count({ where: { status: "failed", createdAt: { gte: day } } }),
    db.webhookDelivery.count({ where: { status: "pending", nextAttemptAt: { lt: new Date(t - 10 * 60_000) } } }),
    db.automationExecution.count({ where: { status: "failed", createdAt: { gte: day } } }),
    db.automationExecution.count({ where: { status: "running", lockedUntil: { lt: new Date(t - 10 * 60_000) } } }),
    db.campaignRecipient.count({ where: { status: "failed", failedAt: { gte: day } } }),
    db.campaignRecipient.count({ where: { sentAt: { gte: day } } }),
    db.apiRequestLog.count({ where: { createdAt: { gte: day } } }),
    db.apiRequestLog.count({ where: { createdAt: { gte: day }, status: { gte: 500 } } }),
    db.apiRequestLog.findMany({ where: { createdAt: { gte: day } }, select: { durationMs: true }, orderBy: { durationMs: "desc" }, take: 2000 }),
    db.supportTicket.count({ where: { status: { in: ["open", "waiting"] } } }),
    db.supportTicket.count({ where: { status: "open", firstResponseAt: null, slaDueAt: { lt: now } } }),
  ]);

  const tickAge = ago(tick?.updatedAt, t);
  const metaAge = ago(lastMeta?.receivedAt, t);
  const count = (s: string) => numbers.find((n) => n.status === s)?._count._all ?? 0;
  const p95 = durations.length ? durations[Math.floor(durations.length * 0.05)]?.durationMs ?? 0 : 0;
  const aiHealth = await Promise.all([providerHealth("anthropic"), providerHealth("openai")]);
  const aiKeys = [has("ANTHROPIC_API_KEY") ? "Anthropic" : "", has("OPENAI_API_KEY") ? "OpenAI" : ""].filter(Boolean);
  const aiOk = aiHealth.some((h) => h?.ok);
  const aiFailed = aiHealth.find((h) => h && !h.ok);
  const checks: Check[] = [
    { key: "database", group: "Platform", label: "Database", status: dbMs < 500 ? "ok" : dbMs < 2000 ? "warn" : "down", detail: `Answered in ${dbMs} ms` },
    { key: "scheduler", group: "Platform", label: "Scheduler (campaigns, automations, retries)", status: tickAge === null ? "down" : tickAge <= 15 ? "ok" : tickAge <= 60 ? "warn" : "down", detail: `Last run ${mins(tickAge)}${tickAge !== null && tickAge > 15 ? ". Check the cron-job.org job or GitHub workflow." : ""}` },
    { key: "meta_app", group: "WhatsApp", label: "Meta app settings", status: has("META_APP_ID", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN") ? "ok" : "config", detail: has("META_APP_ID", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN") ? "App id, secret and webhook token set" : "Add META_APP_ID, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN in Vercel" },
    { key: "meta_webhook", group: "WhatsApp", label: "Meta webhook (incoming messages)", status: metaFailed > 20 ? "down" : metaFailed ? "warn" : count("connected") && metaAge !== null && metaAge > 1440 * 3 ? "warn" : "ok", detail: `Last event ${mins(metaAge)} · ${metaFailed} failed in 24 h` },
    { key: "numbers", group: "WhatsApp", label: "WhatsApp numbers", status: count("disconnected") || redNumbers ? "warn" : "ok", detail: `${count("connected")} connected · ${count("disconnected")} disconnected · ${count("demo")} demo${redNumbers ? ` · ${redNumbers} with LOW quality` : ""}` },
    { key: "messages", group: "WhatsApp", label: "Outgoing messages (24 h)", status: msgs >= 20 && pct(msgFailed, msgs) > 20 ? "down" : msgFailed && pct(msgFailed, msgs) > 5 ? "warn" : "ok", detail: `${msgs} sent · ${msgFailed} failed (${pct(msgFailed, msgs)}%)` },
    { key: "campaigns", group: "WhatsApp", label: "Campaign sending (24 h)", status: campSent >= 20 && pct(campFailed, campSent + campFailed) > 20 ? "down" : campFailed ? "warn" : "ok", detail: `${campSent} sent · ${campFailed} failed` },
    { key: "automations", group: "Automation", label: "Automations (24 h)", status: autoStuck ? "warn" : autoFailed > 50 ? "warn" : "ok", detail: `${autoFailed} failed runs · ${autoStuck} stuck` },
    { key: "webhooks_out", group: "Automation", label: "Client webhooks (outgoing)", status: hooksBacklog > 50 ? "down" : hooksFailed || hooksBacklog ? "warn" : "ok", detail: `${hooksFailed} failed in 24 h · ${hooksBacklog} overdue retries` },
    { key: "api", group: "Automation", label: "Public API (24 h)", status: api >= 50 && pct(api5xx, api) > 5 ? "down" : api5xx ? "warn" : p95 > 3000 ? "warn" : "ok", detail: `${api} requests · ${api5xx} server errors · p95 ${p95} ms` },
    { key: "ai_claude", group: "Providers", label: "AI provider (Claude / OpenAI)", status: !aiKeys.length ? "config" : aiOk ? "ok" : aiFailed ? "down" : "warn", detail: !aiKeys.length ? "Add ANTHROPIC_API_KEY or OPENAI_API_KEY to switch on AI replies" : aiOk ? `${aiKeys.join(" + ")} · answered recently` : aiFailed ? `Last call failed: ${aiFailed.error}` : `${aiKeys.join(" + ")} key set · not verified yet (Admin → Integrations readiness)` },
    { key: "ai_images", group: "Providers", label: "Gemini / OpenAI (images & ad copy)", status: has("GEMINI_API_KEY") || has("OPENAI_API_KEY") ? "ok" : "config", detail: [has("GEMINI_API_KEY") ? "Gemini set" : "", has("OPENAI_API_KEY") ? "OpenAI set" : ""].filter(Boolean).join(" · ") || "Add GEMINI_API_KEY or OPENAI_API_KEY" },
    { key: "email", group: "Providers", label: "Email (Resend)", status: has("RESEND_API_KEY", "EMAIL_FROM") ? "ok" : "config", detail: has("RESEND_API_KEY", "EMAIL_FROM") ? "Sending from " + process.env.EMAIL_FROM : "Add RESEND_API_KEY and EMAIL_FROM" },
    { key: "payments", group: "Providers", label: "Payments (Razorpay)", status: has("RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET") ? "ok" : "config", detail: has("RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET") ? "Keys set" : "Add RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET for online payments" },
    { key: "maps", group: "Providers", label: "Google Maps (outreach)", status: has("GOOGLE_MAPS_API_KEY") ? "ok" : "config", detail: has("GOOGLE_MAPS_API_KEY") ? "Key set" : "Add GOOGLE_MAPS_API_KEY for the outreach finder" },
    { key: "voice", group: "Providers", label: "Voice calls (AI calling)", status: "config", detail: "Practice mode: no voice provider connected" },
    { key: "support", group: "Support", label: "Support desk", status: breached ? "warn" : "ok", detail: `${openTickets} open · ${breached} past their response time` },
  ];
  return { checkedAt: now, checks, summary: { ok: checks.filter((c) => c.status === "ok").length, warn: checks.filter((c) => c.status === "warn").length, down: checks.filter((c) => c.status === "down").length, config: checks.filter((c) => c.status === "config").length } };
}

/** The latest failures across the platform, newest first, for the "Failed jobs" list. */
export async function recentFailures(limit = 40) {
  const [auto, hooks, camp, meta] = await Promise.all([
    db.automationExecution.findMany({ where: { status: "failed" }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, error: true, createdAt: true, organization: { select: { name: true } }, automation: { select: { name: true } } } }),
    db.webhookDelivery.findMany({ where: { status: "failed" }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, error: true, event: true, createdAt: true, organization: { select: { name: true } } } }),
    db.campaignRecipient.findMany({ where: { status: "failed" }, orderBy: { failedAt: "desc" }, take: limit, select: { id: true, error: true, failedAt: true, campaign: { select: { name: true, organization: { select: { name: true } } } } } }),
    db.webhookEvent.findMany({ where: { status: "failed" }, orderBy: { receivedAt: "desc" }, take: limit, select: { id: true, error: true, eventType: true, receivedAt: true, organization: { select: { name: true } } } }),
  ]);
  return [
    ...auto.map((a) => ({ id: a.id, kind: "Automation", what: a.automation?.name ?? "Automation", client: a.organization.name, error: a.error, at: a.createdAt })),
    ...hooks.map((h) => ({ id: h.id, kind: "Client webhook", what: h.event, client: h.organization.name, error: h.error, at: h.createdAt })),
    ...camp.map((c) => ({ id: c.id, kind: "Campaign message", what: c.campaign.name, client: c.campaign.organization.name, error: c.error, at: c.failedAt ?? new Date(0) })),
    ...meta.map((m) => ({ id: m.id, kind: "Meta webhook", what: m.eventType || "event", client: m.organization?.name ?? "—", error: m.error, at: m.receivedAt })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

/** Scheduler: tell Super Admins when a check is down (once an hour per check). */
export async function runHealthAlerts(now = new Date()) {
  const lastRun = Number(await getSetting("health:lastRun", "0"));
  if (now.getTime() - lastRun < 15 * 60_000) return 0;
  await setSetting("health:lastRun", String(now.getTime()));
  const { checks } = await systemHealth(now);
  const down = checks.filter((c) => c.status === "down");
  let sent = 0;
  for (const c of down) {
    const key = `health:alerted:${c.key}`;
    if (now.getTime() - Number(await getSetting(key, "0")) < 3_600_000) continue;
    await setSetting(key, String(now.getTime()));
    const admins = await db.user.findMany({ where: { role: "SUPER_ADMIN", status: "active" }, select: { id: true } });
    for (const a of admins) await notify({ userId: a.id, type: "warning", title: `Down: ${c.label}`, body: c.detail, link: "/admin/health" });
    sent++;
  }
  return sent;
}
