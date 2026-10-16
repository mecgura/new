"use server";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { getPatientAccess } from "@/lib/portal/ctx";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { AppError, ERROR_CODES, zodFieldErrors, type ApiFailure } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { getRequestMeta } from "@/lib/security/request";
import { formDataToObject } from "@/lib/validation";
import { activateSchema, portalLoginSchema } from "@/lib/validation/portal";
import { normalizeIdentifier } from "@/lib/validation/schemas";
import { activatePortalAccount } from "@/lib/services/portal-auth";

/** `values` hands back the NON-secret fields so the form keeps them after a failed attempt (React resets uncontrolled forms). Passwords are never returned. */
export type PortalFormState = (Pick<ApiFailure["error"], "message" | "fieldErrors"> & { values?: Record<string, string> }) | null;
const keep = (raw: Record<string, unknown>) => Object.fromEntries(["clinic", "identifier", "code"].map((k) => [k, typeof raw[k] === "string" ? (raw[k] as string).slice(0, 254) : ""]));
import { safePortalPath } from "@/lib/portal/safe-path";

export async function portalLoginAction(_prev: PortalFormState, formData: FormData): Promise<PortalFormState> {
  const raw = formDataToObject(formData);
  const parsed = portalLoginSchema.safeParse(raw);
  if (!parsed.success) return { message: ERROR_CODES.VALIDATION_ERROR.message, fieldErrors: zodFieldErrors(parsed.error), values: keep(raw) };
  const { ip } = await getRequestMeta(); const id = normalizeIdentifier(parsed.data.identifier)!;
  const [byIp, byAcct] = await Promise.all([rateLimit(`plogin:ip:${ip ?? "unknown"}`, { limit: 25, windowMs: 15 * 60_000 }), rateLimit(`plogin:acct:${parsed.data.clinic ?? "-"}:${id.value}`, { limit: 8, windowMs: 15 * 60_000 })]);
  if (!byIp.allowed || !byAcct.allowed) return { message: "Too many attempts. Please wait a few minutes and try again.", values: keep(raw) };
  try {
    await signIn("patient", { clinic: parsed.data.clinic ?? "", identifier: parsed.data.identifier, password: parsed.data.password, redirectTo: safePortalPath(raw.callbackUrl) });
  } catch (err) {
    if (err instanceof AuthError) return { message: "Incorrect details, or the account is temporarily locked. If you forgot your password, ask the clinic for a new access code.", values: keep(raw) };
    throw err; // NEXT_REDIRECT on success
  }
  return null;
}
export async function portalActivateAction(_prev: PortalFormState, formData: FormData): Promise<PortalFormState> {
  const raw = formDataToObject(formData);
  const parsed = activateSchema.safeParse({ ...raw, acceptPrivacy: raw.acceptPrivacy === "on" || raw.acceptPrivacy === "true" });
  if (!parsed.success) return { message: ERROR_CODES.VALIDATION_ERROR.message, fieldErrors: zodFieldErrors(parsed.error), values: keep(raw) };
  const { ip } = await getRequestMeta();
  try { await activatePortalAccount(parsed.data, ip); }
  catch (e) { if (e instanceof AppError) return { message: e.message, fieldErrors: e.fieldErrors, values: keep(raw) }; throw e; }
  try { await signIn("patient", { clinic: parsed.data.clinic ?? "", identifier: parsed.data.identifier, password: parsed.data.password, redirectTo: "/portal/dashboard" }); }
  catch (err) { if (err instanceof AuthError) return { message: "Your account is ready. Please sign in with your new password.", values: keep(raw) }; throw err; }
  return null;
}
export async function portalLogoutAction() {
  const { ctx } = await getPatientAccess();
  if (ctx) await recordAudit({ action: AUDIT_ACTIONS.PORTAL_LOGOUT, tenantId: ctx.tenantId, actorId: ctx.user.id });
  await signOut({ redirectTo: "/portal/login" });
}
