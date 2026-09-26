import { get, insert } from '../db.ts'
import { config } from '../config.ts'
import { randomToken, sha256 } from '../lib/security.ts'
import { brandedEmail, notifyByEmail, escapeHtml, platformEmailReady } from './email.ts'

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function workspaceOwner(workspaceId: number) {
  return get<{ id: number; name: string; email: string; phone: string | null }>(
    "SELECT u.id, u.name, u.email, u.phone FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'owner' ORDER BY m.id LIMIT 1", workspaceId)
}

export function createResetLink(userId: number, days = 1) {
  const token = randomToken(24)
  insert('password_resets', { token_hash: sha256(token), user_id: userId, expires_at: new Date(Date.now() + days * 86400000).toISOString() })
  return `${config.appUrl}/reset/${token}`
}

export function mailWelcome(user: { id: number; name: string; email: string }, company: string) {
  if (!platformEmailReady()) return false
  notifyByEmail({ to: user.email, kind: 'welcome', subject: `Your MECGURA WhatsApp account for ${company} is ready`, html: brandedEmail({
    title: `Welcome, ${user.name.split(' ')[0]}!`,
    intro: `Your <b>MECGURA WhatsApp</b> workspace for <b>${escapeHtml(company)}</b> is ready. Set your password to sign in.`,
    rows: [['Login email', user.email], ['Dashboard', config.appUrl.replace(/^https?:\/\//, '')]],
    button: { label: 'Set password & sign in', url: createResetLink(user.id, 7) },
    outro: 'This link is valid for 7 days. Need help getting live on WhatsApp? Just reply to this email.' }) })
  return true
}

export function mailInvoice(workspaceId: number, inv: { id: number; amount: number; plan: string; cycle: string; url: string }) {
  const o = workspaceOwner(workspaceId)
  if (!o || !platformEmailReady()) return false
  notifyByEmail({ to: o.email, kind: 'invoice', workspaceId, subject: `MECGURA bill #${inv.id} — ${inr(inv.amount)}`, html: brandedEmail({
    title: 'Your MECGURA WhatsApp bill', intro: `Hi ${escapeHtml(o.name.split(' ')[0])}, here is your bill. Pay securely with UPI, card or netbanking — your plan activates automatically.`,
    rows: [['Bill no.', `#${inv.id}`], ['Plan', `${inv.plan} (${inv.cycle})`], ['Amount', inr(inv.amount)]],
    button: { label: `Pay ${inr(inv.amount)}`, url: inv.url }, outro: 'Payments are processed by Razorpay. Meta WhatsApp message charges are billed by Meta separately.' }) })
  return true
}

export function mailReceipt(workspaceId: number, inv: { id: number; amount: number; plan: string; cycle: string; validUntil: string; reference?: string }) {
  const o = workspaceOwner(workspaceId)
  if (!o) return
  notifyByEmail({ to: o.email, kind: 'receipt', workspaceId, subject: `Payment received — MECGURA receipt #${inv.id}`, html: brandedEmail({
    title: 'Payment received — thank you!', intro: `Hi ${escapeHtml(o.name.split(' ')[0])}, we have received your payment. Your plan is active.`,
    rows: [['Receipt no.', `#${inv.id}`], ['Plan', `${inv.plan} (${inv.cycle})`], ['Amount paid', inr(inv.amount)], ['Valid until', date(inv.validUntil)], ...(inv.reference ? [['Reference', inv.reference] as [string, string]] : [])],
    button: { label: 'Open dashboard', url: `${config.appUrl}/app` } }) })
}

export function mailInvite(email: string, workspace: string, role: string, link: string, inviter: string) {
  if (!platformEmailReady()) return false
  notifyByEmail({ to: email, kind: 'invite', subject: `${inviter} invited you to ${workspace} on MECGURA WhatsApp`, html: brandedEmail({
    title: `Join ${workspace}`, intro: `<b>${escapeHtml(inviter)}</b> invited you to the <b>${escapeHtml(workspace)}</b> team as <b>${escapeHtml(role)}</b>.`,
    button: { label: 'Accept invite', url: link }, outro: 'This invite is valid for 7 days.' }) })
  return true
}

export function mailReset(user: { id: number; email: string; name: string }) {
  notifyByEmail({ to: user.email, kind: 'password_reset', subject: 'Reset your MECGURA WhatsApp password', html: brandedEmail({
    title: 'Reset your password', intro: `Hi ${escapeHtml(user.name.split(' ')[0])}, click below to choose a new password.`,
    button: { label: 'Choose new password', url: createResetLink(user.id, 1) }, outro: "This link is valid for 24 hours. If you didn't ask for this, you can ignore this email." }) })
}

export function mailPlanReminder(workspaceId: number, title: string, body: string) {
  const o = workspaceOwner(workspaceId)
  if (!o) return
  notifyByEmail({ to: o.email, kind: 'plan_reminder', workspaceId, subject: title, html: brandedEmail({ title, intro: escapeHtml(body),
    outro: `To renew, reply to this email or WhatsApp us at ${config.brand.phone}.` }) })
}
