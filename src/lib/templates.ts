// WhatsApp message-template rules. Pure module (no DB / Node APIs) so the
// editor preview, the server validation and the send path all share one
// definition of what a valid template is.

export const TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utility",
  AUTHENTICATION: "Authentication",
};

export const CATEGORY_HINTS: Record<TemplateCategory, string> = {
  MARKETING: "Offers, announcements, festival greetings, re-engagement. Needs marketing opt-in.",
  UTILITY: "Updates the customer asked for: orders, bookings, payments, appointments. No promotional content — Meta re-categorises it as Marketing.",
  AUTHENTICATION: "One-time passcodes only. Meta fixes the wording; you choose expiry and the copy-code button.",
};

export const TEMPLATE_STATUSES = ["draft", "pending", "approved", "rejected", "paused", "disabled"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const STATUS_LABELS: Record<TemplateStatus, string> = {
  draft: "Draft",
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  paused: "Paused by Meta",
  disabled: "Disabled by Meta",
};

/** Languages offered in the editor (Meta locale codes). */
export const TEMPLATE_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "hi", label: "Hindi" },
  { code: "pa", label: "Punjabi" },
  { code: "gu", label: "Gujarati" },
  { code: "mr", label: "Marathi" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "ur", label: "Urdu" },
  { code: "ar", label: "Arabic" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt_BR", label: "Portuguese (BR)" },
  { code: "id", label: "Indonesian" },
];
export const LANGUAGE_CODES = TEMPLATE_LANGUAGES.map((l) => l.code);

export const HEADER_TYPES = ["none", "text", "image", "video", "document"] as const;
export type HeaderType = (typeof HEADER_TYPES)[number];

export const LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  footer: 60,
  buttonText: 25,
  buttons: 10,
  quickReplies: 10,
  urlButtons: 2,
  phoneButtons: 1,
  url: 2000,
  param: 1024,
};

export type TemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string; example?: string }
  | { type: "PHONE_NUMBER"; text: string; phone: string };

export type AuthOptions = { addSecurityRecommendation: boolean; codeExpirationMinutes: number | null; buttonText: string };

export type TemplateExamples = { header?: string[]; body?: string[] };

export type TemplateDef = {
  name: string;
  language: string;
  category: TemplateCategory;
  headerType: HeaderType;
  headerText: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  examples: TemplateExamples;
  authOptions: AuthOptions;
};

export const DEFAULT_AUTH_OPTIONS: AuthOptions = { addSecurityRecommendation: true, codeExpirationMinutes: 10, buttonText: "Copy code" };

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

const VAR = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Positional variable numbers used in `text`, in order of appearance ({{1}}, {{2}}…). */
export function variablesIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(VAR)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return out;
}

/** Highest variable number = number of values the sender must supply. */
export function variableCount(text: string): number {
  return variablesIn(text).reduce((a, b) => Math.max(a, b), 0);
}

function variableProblems(text: string, label: string): string[] {
  const errs: string[] = [];
  for (const m of text.matchAll(VAR)) {
    if (!/^[1-9]\d*$/.test(m[1])) errs.push(`${label}: use numbered variables like {{1}}, {{2}} — “${m[0]}” isn't valid.`);
  }
  if (/\{\{(?![^{}]*\}\})|(?<!\{\{[^{}]*)\}\}/.test(text)) errs.push(`${label}: a variable is missing its {{ or }}.`);
  const nums = [...new Set(variablesIn(text))].sort((a, b) => a - b);
  if (nums.some((n, i) => n !== i + 1)) errs.push(`${label}: variables must be numbered in sequence starting at {{1}}.`);
  return errs;
}

export type Slot =
  | { key: string; part: "header"; kind: "text"; label: string }
  | { key: string; part: "header"; kind: "media"; label: string; mediaType: "image" | "video" | "document" }
  | { key: string; part: "body"; index: number; label: string }
  | { key: string; part: "button"; index: number; label: string };

/** Every value a sender has to provide for this template, in a stable order. */
export function templateSlots(t: Pick<TemplateDef, "category" | "headerType" | "headerText" | "body" | "buttons">): Slot[] {
  if (t.category === "AUTHENTICATION") return [{ key: "body.1", part: "body", index: 1, label: "Verification code" }];
  const slots: Slot[] = [];
  if (t.headerType === "text" && variableCount(t.headerText) > 0) slots.push({ key: "header", part: "header", kind: "text", label: "Header {{1}}" });
  if (t.headerType === "image" || t.headerType === "video" || t.headerType === "document") {
    slots.push({ key: "header", part: "header", kind: "media", mediaType: t.headerType, label: `Header ${t.headerType} link (https)` });
  }
  for (let i = 1; i <= variableCount(t.body); i++) slots.push({ key: `body.${i}`, part: "body", index: i, label: `Body {{${i}}}` });
  t.buttons.forEach((b, i) => {
    if (b.type === "URL" && variableCount(b.url) > 0) slots.push({ key: `button.${i}`, part: "button", index: i, label: `“${b.text}” link suffix {{1}}` });
  });
  return slots;
}

/** WhatsApp rejects parameters with newlines/tabs or more than 4 consecutive spaces. */
export function paramProblem(value: string, kind: "text" | "media" = "text"): string | null {
  const v = value ?? "";
  if (!v.trim()) return "is empty";
  if (kind === "media") return /^https:\/\/\S+$/i.test(v) && v.length <= LIMITS.url ? null : "must be an https:// link";
  if (/[\n\t]/.test(v)) return "can't contain line breaks or tabs";
  if (/ {5,}/.test(v)) return "can't contain more than 4 spaces in a row";
  if (v.length > LIMITS.param) return `is longer than ${LIMITS.param} characters`;
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationResult = { errors: Record<string, string[]>; warnings: string[] };

/**
 * Meta's template rules. `forSubmit` adds the checks Meta's review needs
 * (samples for every variable); drafts can be saved half-finished.
 */
export function validateTemplate(t: TemplateDef, opts: { forSubmit?: boolean } = {}): ValidationResult {
  const errors: Record<string, string[]> = {};
  const warnings: string[] = [];
  const err = (k: string, m: string) => (errors[k] ??= []).push(m);

  if (!/^[a-z0-9_]+$/.test(t.name)) err("name", "Use lowercase letters, numbers and underscores only (e.g. diwali_offer_2026).");
  if (t.name.length > LIMITS.name) err("name", `Max ${LIMITS.name} characters.`);
  if (!LANGUAGE_CODES.includes(t.language)) err("language", "Choose a supported language.");
  if (!(TEMPLATE_CATEGORIES as readonly string[]).includes(t.category)) err("category", "Choose a category.");

  if (t.category === "AUTHENTICATION") {
    const exp = t.authOptions.codeExpirationMinutes;
    if (exp !== null && (!Number.isInteger(exp) || exp < 1 || exp > 90)) err("authOptions.codeExpirationMinutes", "Expiry must be between 1 and 90 minutes.");
    if (!t.authOptions.buttonText.trim() || t.authOptions.buttonText.length > LIMITS.buttonText) err("authOptions.buttonText", `Button text: 1–${LIMITS.buttonText} characters.`);
    return { errors, warnings };
  }

  // Header
  if (t.headerType === "text") {
    if (!t.headerText.trim()) err("headerText", "Enter header text or choose “No header”.");
    if (t.headerText.length > LIMITS.headerText) err("headerText", `Max ${LIMITS.headerText} characters.`);
    for (const p of variableProblems(t.headerText, "Header")) err("headerText", p);
    if (variableCount(t.headerText) > 1) err("headerText", "The header can have at most one variable ({{1}}).");
    if (/[*_~\n]|\p{Extended_Pictographic}/u.test(t.headerText)) err("headerText", "Header text can't contain formatting, line breaks or emoji.");
    if (opts.forSubmit && variableCount(t.headerText) === 1 && !t.examples.header?.[0]?.trim()) err("examples.header", "Add a sample value for the header variable.");
  }

  // Body
  const body = t.body;
  if (!body.trim()) err("body", "The message body is required.");
  if (body.length > LIMITS.body) err("body", `Max ${LIMITS.body} characters.`);
  for (const p of variableProblems(body, "Body")) err("body", p);
  const trimmed = body.trim();
  if (/^\{\{[^{}]*\}\}/.test(trimmed) || /\{\{[^{}]*\}\}[.!?…]?$/.test(trimmed)) err("body", "Meta rejects templates that start or end with a variable — add text before/after it.");
  if (/\{\{[^{}]*\}\}\s*\{\{[^{}]*\}\}/.test(body)) err("body", "Put words between variables — Meta rejects variables placed next to each other.");
  if (/\n{3,}/.test(body)) err("body", "Use at most one blank line in a row.");
  const vars = variableCount(body);
  const words = body.replace(VAR, " ").split(/\s+/).filter(Boolean).length;
  if (vars > 0 && words < vars * 3) warnings.push("Very few words for the number of variables — Meta often rejects this. Add more fixed text.");
  if (opts.forSubmit) {
    for (let i = 1; i <= vars; i++) if (!t.examples.body?.[i - 1]?.trim()) err(`examples.body.${i}`, `Add a sample value for {{${i}}}.`);
  }

  // Footer
  if (t.footer.length > LIMITS.footer) err("footer", `Max ${LIMITS.footer} characters.`);
  if (variablesIn(t.footer).length || /\{\{/.test(t.footer)) err("footer", "The footer can't contain variables.");

  // Buttons
  const b = t.buttons;
  if (b.length > LIMITS.buttons) err("buttons", `Max ${LIMITS.buttons} buttons.`);
  const count = (type: TemplateButton["type"]) => b.filter((x) => x.type === type).length;
  if (count("QUICK_REPLY") > LIMITS.quickReplies) err("buttons", `Max ${LIMITS.quickReplies} quick replies.`);
  if (count("URL") > LIMITS.urlButtons) err("buttons", `Max ${LIMITS.urlButtons} website buttons.`);
  if (count("PHONE_NUMBER") > LIMITS.phoneButtons) err("buttons", `Max ${LIMITS.phoneButtons} call button.`);
  const qrIdx = b.map((x, i) => (x.type === "QUICK_REPLY" ? i : -1)).filter((i) => i >= 0);
  if (qrIdx.length && qrIdx[qrIdx.length - 1] - qrIdx[0] + 1 !== qrIdx.length) err("buttons", "Keep quick-reply buttons together (before or after the website/call buttons).");
  const texts = new Set<string>();
  b.forEach((x, i) => {
    const k = `buttons.${i}`;
    if (!x.text.trim() || x.text.length > LIMITS.buttonText) err(k, `Button text: 1–${LIMITS.buttonText} characters.`);
    if (texts.has(x.text.trim().toLowerCase())) err(k, "Button texts must be unique.");
    texts.add(x.text.trim().toLowerCase());
    if (x.type === "URL") {
      if (!/^https?:\/\/[^\s{}]+(\{\{1\}\})?$/.test(x.url) || x.url.length > LIMITS.url) err(k, "Enter a full website link. A variable is only allowed as {{1}} at the very end.");
      if (opts.forSubmit && variableCount(x.url) && !/^https?:\/\/\S+$/.test(x.example ?? "")) err(k, "Add a sample full link for the variable.");
    }
    if (x.type === "PHONE_NUMBER" && !/^\+[1-9]\d{7,14}$/.test(x.phone)) err(k, "Enter the phone number with country code, e.g. +919876543210.");
  });

  if (t.category === "MARKETING" && !/stop|opt.?out|unsubscribe/i.test(`${t.footer} ${t.body} ${b.map((x) => x.text).join(" ")}`)) {
    warnings.push("Tip: add an opt-out line (e.g. footer “Reply STOP to unsubscribe”) — it reduces blocks and protects your quality rating.");
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Meta formats
// ---------------------------------------------------------------------------

/** Template → Meta "create template" components (POST /{waba}/message_templates). */
export function toMetaComponents(t: TemplateDef, headerHandle?: string): Record<string, unknown>[] {
  if (t.category === "AUTHENTICATION") {
    return [
      { type: "BODY", add_security_recommendation: t.authOptions.addSecurityRecommendation },
      ...(t.authOptions.codeExpirationMinutes ? [{ type: "FOOTER", code_expiration_minutes: t.authOptions.codeExpirationMinutes }] : []),
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: t.authOptions.buttonText }] },
    ];
  }
  const out: Record<string, unknown>[] = [];
  if (t.headerType === "text") {
    out.push({ type: "HEADER", format: "TEXT", text: t.headerText, ...(variableCount(t.headerText) ? { example: { header_text: [t.examples.header?.[0] ?? ""] } } : {}) });
  } else if (t.headerType !== "none") {
    out.push({ type: "HEADER", format: t.headerType.toUpperCase(), ...(headerHandle ? { example: { header_handle: [headerHandle] } } : {}) });
  }
  const vars = variableCount(t.body);
  out.push({ type: "BODY", text: t.body, ...(vars ? { example: { body_text: [Array.from({ length: vars }, (_, i) => t.examples.body?.[i] ?? "")] } } : {}) });
  if (t.footer.trim()) out.push({ type: "FOOTER", text: t.footer });
  if (t.buttons.length) {
    out.push({
      type: "BUTTONS",
      buttons: t.buttons.map((b) =>
        b.type === "URL"
          ? { type: "URL", text: b.text, url: b.url, ...(variableCount(b.url) ? { example: [b.example ?? ""] } : {}) }
          : b.type === "PHONE_NUMBER"
            ? { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone }
            : { type: "QUICK_REPLY", text: b.text }
      ),
    });
  }
  return out;
}

type MetaComponent = {
  type?: string;
  format?: string;
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][] };
  buttons?: { type?: string; text?: string; url?: string; phone_number?: string; example?: string[] }[];
  add_security_recommendation?: boolean;
  code_expiration_minutes?: number;
};

/** Meta template components → editor fields (used when syncing templates created in Meta). */
export function fromMetaComponents(category: string, components: MetaComponent[]): Omit<TemplateDef, "name" | "language"> {
  const cat = (TEMPLATE_CATEGORIES as readonly string[]).includes(category) ? (category as TemplateCategory) : "UTILITY";
  const by = (type: string) => components.find((c) => c.type?.toUpperCase() === type);
  const header = by("HEADER");
  const body = by("BODY");
  const footer = by("FOOTER");
  const buttons = by("BUTTONS")?.buttons ?? [];
  if (cat === "AUTHENTICATION") {
    return {
      category: cat,
      headerType: "none",
      headerText: "",
      body: body?.text ?? "",
      footer: footer?.text ?? "",
      buttons: [],
      examples: {},
      authOptions: {
        addSecurityRecommendation: Boolean(body?.add_security_recommendation),
        codeExpirationMinutes: footer?.code_expiration_minutes ?? null,
        buttonText: buttons[0]?.text ?? "Copy code",
      },
    };
  }
  const fmt = header?.format?.toLowerCase();
  const headerType: HeaderType = fmt === "text" || fmt === "image" || fmt === "video" || fmt === "document" ? fmt : "none";
  return {
    category: cat,
    headerType,
    headerText: headerType === "text" ? (header?.text ?? "") : "",
    body: body?.text ?? "",
    footer: footer?.text ?? "",
    buttons: buttons
      .map((b): TemplateButton | null =>
        b.type === "URL"
          ? { type: "URL", text: b.text ?? "", url: b.url ?? "", example: b.example?.[0] }
          : b.type === "PHONE_NUMBER"
            ? { type: "PHONE_NUMBER", text: b.text ?? "", phone: b.phone_number ?? "" }
            : b.type === "QUICK_REPLY"
              ? { type: "QUICK_REPLY", text: b.text ?? "" }
              : null
      )
      .filter((b): b is TemplateButton => b !== null),
    examples: { header: header?.example?.header_text, body: body?.example?.body_text?.[0] },
    authOptions: DEFAULT_AUTH_OPTIONS,
  };
}

/** Meta review status → MECGURA status. */
export function mapMetaStatus(status: string): TemplateStatus {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
    case "LIMIT_EXCEEDED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
    case "DELETED":
      return "disabled";
    default:
      return "pending"; // PENDING, IN_APPEAL, PENDING_DELETION, …
  }
}

/** Values the sender supplies, keyed by slot key ("header", "body.1", "button.0"). */
export type SlotValues = Record<string, string>;

/** Template + values → Cloud API send components. */
export function toSendComponents(t: Pick<TemplateDef, "category" | "headerType" | "headerText" | "body" | "buttons">, values: SlotValues): Record<string, unknown>[] {
  if (t.category === "AUTHENTICATION") {
    const code = values["body.1"] ?? "";
    return [
      { type: "body", parameters: [{ type: "text", text: code }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
    ];
  }
  const out: Record<string, unknown>[] = [];
  for (const s of templateSlots(t)) {
    const v = values[s.key] ?? "";
    if (s.part === "header") {
      out.push({ type: "header", parameters: [s.kind === "media" ? { type: s.mediaType, [s.mediaType]: { link: v } } : { type: "text", text: v }] });
    }
  }
  const bodyVars = variableCount(t.body);
  if (bodyVars) out.push({ type: "body", parameters: Array.from({ length: bodyVars }, (_, i) => ({ type: "text", text: values[`body.${i + 1}`] ?? "" })) });
  t.buttons.forEach((b, i) => {
    if (b.type === "URL" && variableCount(b.url)) out.push({ type: "button", sub_type: "url", index: String(i), parameters: [{ type: "text", text: values[`button.${i}`] ?? "" }] });
  });
  return out;
}

/** Fills {{n}} with values (or keeps the placeholder) for previews and inbox history. */
export function fillVariables(text: string, values: (string | undefined)[]): string {
  return text.replace(VAR, (m, n) => {
    const v = values[Number(n) - 1];
    return v?.trim() ? v : m;
  });
}

/** Rendered text of a template (what the customer sees), for previews and message history. */
export function renderTemplate(t: Pick<TemplateDef, "category" | "headerType" | "headerText" | "body" | "footer" | "authOptions">, values: SlotValues = {}) {
  if (t.category === "AUTHENTICATION") {
    const code = values["body.1"] || "{{1}}";
    return {
      header: "",
      body: `*${code}* is your verification code.${t.authOptions.addSecurityRecommendation ? " For your security, do not share this code." : ""}`,
      footer: t.authOptions.codeExpirationMinutes ? `This code expires in ${t.authOptions.codeExpirationMinutes} minutes.` : "",
    };
  }
  const bodyVals = Array.from({ length: variableCount(t.body) }, (_, i) => values[`body.${i + 1}`]);
  return {
    header: t.headerType === "text" ? fillVariables(t.headerText, [values.header]) : "",
    body: fillVariables(t.body, bodyVals),
    footer: t.footer,
  };
}
