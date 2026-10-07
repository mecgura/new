import { LIMITS, VAR_NAMES, type Channel, type VarName } from "./catalog";

/** `{{name}}` substitution ONLY. No expressions, no helpers, no code — the pattern is the whole grammar. */
const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const KNOWN = new Set<string>(VAR_NAMES);

export const usedVariables = (text: string): string[] => [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1]))];

/** Values come from our own database but may contain anything a user typed (names). Strip control characters and cap the length. */
export function cleanValue(v: unknown, oneLine: boolean): string {
  let s = String(v ?? "");
   
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, "");
  s = oneLine ? s.replace(/\s+/g, " ") : s.replace(/[ \t]+/g, " ");
  return s.trim().slice(0, 200);
}

export function renderTemplate(text: string, vars: Partial<Record<VarName, string>>): string {
  return text.replace(VAR_RE, (_m, name: string) => (KNOWN.has(name) ? cleanValue(vars[name as VarName], true) : ""));
}

export interface TemplateInput { channel: Channel; subject?: string | null; body: string; providerTemplateId?: string | null; status?: string }
/** Problems that stop a template from being saved / activated. Empty array = valid. */
export function validateTemplate(t: TemplateInput): string[] {
  const out: string[] = []; const body = t.body.trim();
  if (!body) out.push("The message text is empty.");
  const lim = LIMITS[t.channel];
  if (body.length > lim.body) out.push(`The ${t.channel === "SMS" ? "SMS" : t.channel === "WHATSAPP" ? "WhatsApp" : "email"} text is too long (${body.length}/${lim.body} characters).`);
  if (t.channel === "EMAIL") { const s = (t.subject ?? "").trim(); if (!s) out.push("An email needs a subject."); if (s.length > lim.subject) out.push(`The subject is too long (${s.length}/${lim.subject}).`); if (/[\r\n]/.test(t.subject ?? "")) out.push("The subject must be one line."); }
  else if (t.subject?.trim()) out.push("Only email templates have a subject.");
  const vars = usedVariables(`${t.subject ?? ""}\n${body}`); const unknown = vars.filter((v) => !KNOWN.has(v));
  if (unknown.length) out.push(`Unsupported variable${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}.`);
  const stray = body.replace(VAR_RE, "").match(/\{\{|\}\}|\{%|%\}|\$\{/);
  if (stray) out.push("The text has a stray brace or code-like marker. Use only {{variable}} placeholders.");
  if (t.channel === "WHATSAPP" && t.providerTemplateId !== undefined && t.providerTemplateId !== null && t.providerTemplateId !== "" && !/^[a-z0-9_]{1,512}$/.test(t.providerTemplateId)) out.push("The WhatsApp template name must be lowercase letters, digits and underscores (as approved by the provider).");
  if (t.channel === "SMS" && t.providerTemplateId && !/^[A-Za-z0-9_-]{1,64}$/.test(t.providerTemplateId)) out.push("The SMS template id has unsupported characters.");
  if (t.status === "ACTIVE" && t.channel === "WHATSAPP" && !t.providerTemplateId) out.push("A WhatsApp template can only be activated with the template name approved by your WhatsApp provider.");
  return out;
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
