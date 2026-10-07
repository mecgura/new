// WhatsApp Flows (in-chat forms). Pure module shared by the builder UI, the
// API validation, Meta publishing and submission processing.

/** Flow JSON schema version sent to Meta. Bump when Meta retires it. */
export const FLOW_JSON_VERSION = "6.3";

export const FLOW_CATEGORIES = ["APPOINTMENT_BOOKING", "LEAD_GENERATION", "CONTACT_US", "CUSTOMER_SUPPORT", "SURVEY", "OTHER"] as const;
export type FlowCategory = (typeof FLOW_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<FlowCategory, string> = {
  APPOINTMENT_BOOKING: "Appointment booking",
  LEAD_GENERATION: "Lead generation",
  CONTACT_US: "Contact us",
  CUSTOMER_SUPPORT: "Customer support",
  SURVEY: "Survey / feedback",
  OTHER: "Other",
};

export const INPUT_TYPES = ["text", "email", "phone", "number", "textarea", "date"] as const;
export const SELECTION_TYPES = ["dropdown", "radio", "checkbox", "optin"] as const;
export type FieldType = (typeof INPUT_TYPES)[number] | (typeof SELECTION_TYPES)[number];
export const FIELD_LABELS: Record<FieldType, string> = {
  text: "Short text",
  email: "Email",
  phone: "Phone",
  number: "Number",
  textarea: "Long text",
  date: "Date",
  dropdown: "Dropdown",
  radio: "Single choice",
  checkbox: "Multiple choice",
  optin: "Consent checkbox",
};
export const isSelection = (t: FieldType) => (SELECTION_TYPES as readonly string[]).includes(t);

export type FlowField = { name: string; type: FieldType; label: string; required: boolean; options: string[] };
export type FlowScreen = { title: string; intro: string; fields: FlowField[]; buttonLabel: string };

/** CRM action on submit: what to create/update on the contact. */
export type FlowCrm = {
  fieldMap: Record<string, "ignore" | "name" | "email" | "custom">; // per field name
  lifecycle: "" | "lead" | "customer";
  leadStatus: "" | "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";
  tags: string[];
  consentField: string; // an optin field → records WhatsApp opt-in with evidence
  appointment: { enabled: boolean; serviceField: string; dateField: string; timeField: string };
  assign: "none" | "auto";
  addNote: boolean;
};

export type FlowDefinition = {
  start: { cta: string; body: string };
  screens: FlowScreen[];
  confirmation: { enabled: boolean; title: string; body: string };
  submit: { label: string; thankYou: string };
  crm: FlowCrm;
};

export const LIMITS = { screens: 8, fieldsPerScreen: 10, options: 20, label: 30, title: 30, cta: 20, body: 1024, option: 30 };

const f = (name: string, type: FieldType, label: string, required = true, options: string[] = []): FlowField => ({ name, type, label, required, options });
const crm = (over: Partial<FlowCrm>): FlowCrm => ({
  fieldMap: {},
  lifecycle: "",
  leadStatus: "",
  tags: [],
  consentField: "",
  appointment: { enabled: false, serviceField: "", dateField: "", timeField: "" },
  assign: "none",
  addNote: true,
  ...over,
});

export const FLOW_TEMPLATES: Record<"appointment" | "lead" | "product" | "feedback" | "order", { name: string; category: FlowCategory; description: string; definition: FlowDefinition }> = {
  appointment: {
    name: "Appointment Booking",
    category: "APPOINTMENT_BOOKING",
    description: "Service, date, time slot and contact details — creates an appointment request.",
    definition: {
      start: { cta: "Book now", body: "Book your appointment in a few taps 📅" },
      screens: [
        {
          title: "Choose a slot",
          intro: "Pick a service and a time that suits you.",
          fields: [f("service", "dropdown", "Service", true, ["Consultation", "Website design", "Digital marketing"]), f("preferred_date", "date", "Preferred date"), f("time_slot", "radio", "Time slot", true, ["Morning (10–12)", "Afternoon (12–4)", "Evening (4–7)"])],
          buttonLabel: "Continue",
        },
        { title: "Your details", intro: "", fields: [f("full_name", "text", "Full name"), f("email", "email", "Email", false), f("notes", "textarea", "Anything we should know?", false)], buttonLabel: "Continue" },
      ],
      confirmation: { enabled: true, title: "Confirm booking", body: "Please check your details before submitting." },
      submit: { label: "Book appointment", thankYou: "Thanks! We've received your request and will confirm your appointment shortly." },
      crm: crm({ fieldMap: { full_name: "name", email: "email", notes: "custom" }, leadStatus: "contacted", tags: ["Appointment request"], appointment: { enabled: true, serviceField: "service", dateField: "preferred_date", timeField: "time_slot" } }),
    },
  },
  lead: {
    name: "Lead Registration",
    category: "LEAD_GENERATION",
    description: "Name, email, city, interest and budget — creates or updates a qualified lead.",
    definition: {
      start: { cta: "Register", body: "Tell us a little about yourself and we'll get back to you 🙌" },
      screens: [
        {
          title: "About you",
          intro: "",
          fields: [f("full_name", "text", "Full name"), f("email", "email", "Email"), f("city", "text", "City", false), f("interest", "checkbox", "Interested in", true, ["Website", "SEO", "Ads", "Social media", "Branding"]), f("budget", "dropdown", "Monthly budget", false, ["Under ₹10k", "₹10k–₹25k", "₹25k–₹50k", "₹50k+"]), f("marketing_optin", "optin", "Send me offers on WhatsApp", false)],
          buttonLabel: "Continue",
        },
      ],
      confirmation: { enabled: true, title: "Check your details", body: "" },
      submit: { label: "Register", thankYou: "Thanks for registering! Our team will contact you soon." },
      crm: crm({ fieldMap: { full_name: "name", email: "email", city: "custom", interest: "custom", budget: "custom" }, lifecycle: "lead", leadStatus: "qualified", tags: ["Flow lead"], consentField: "marketing_optin", assign: "auto" }),
    },
  },
  product: {
    name: "Product Enquiry",
    category: "CONTACT_US",
    description: "Product, quantity and question — tags the contact and routes it to the team.",
    definition: {
      start: { cta: "Enquire", body: "Have a question about a product? Ask us here 🛍️" },
      screens: [
        { title: "Your enquiry", intro: "", fields: [f("product", "dropdown", "Product", true, ["Starter website", "Business website", "E-commerce store"]), f("quantity", "number", "Quantity", false), f("question", "textarea", "Your question"), f("full_name", "text", "Your name")], buttonLabel: "Continue" },
      ],
      confirmation: { enabled: false, title: "", body: "" },
      submit: { label: "Send enquiry", thankYou: "Thanks! A team member will reply with details." },
      crm: crm({ fieldMap: { full_name: "name", product: "custom", question: "custom" }, lifecycle: "lead", leadStatus: "new", tags: ["Product enquiry"], assign: "auto" }),
    },
  },
  feedback: {
    name: "Feedback",
    category: "SURVEY",
    description: "Rating, what went well and suggestions — saved on the contact and in submissions.",
    definition: {
      start: { cta: "Give feedback", body: "How did we do? Your feedback takes 30 seconds ⭐" },
      screens: [
        { title: "Your feedback", intro: "", fields: [f("rating", "radio", "Overall rating", true, ["⭐⭐⭐⭐⭐ Excellent", "⭐⭐⭐⭐ Good", "⭐⭐⭐ Okay", "⭐⭐ Poor", "⭐ Very poor"]), f("liked", "checkbox", "What did you like?", false, ["Quality", "Speed", "Communication", "Price"]), f("comments", "textarea", "Suggestions", false)], buttonLabel: "Submit" },
      ],
      confirmation: { enabled: false, title: "", body: "" },
      submit: { label: "Submit feedback", thankYou: "Thank you for your feedback! 🙏" },
      crm: crm({ fieldMap: { rating: "custom", comments: "custom" }, tags: ["Feedback given"] }),
    },
  },
  order: {
    name: "Order Enquiry",
    category: "CUSTOMER_SUPPORT",
    description: "Order number, issue type and details — tags the contact and assigns support.",
    definition: {
      start: { cta: "Order help", body: "Need help with an order? Tell us here 📦" },
      screens: [
        { title: "Your order", intro: "", fields: [f("order_number", "text", "Order number"), f("issue", "radio", "What do you need?", true, ["Order status", "Change order", "Return / refund", "Something else"]), f("details", "textarea", "Details", false)], buttonLabel: "Continue" },
      ],
      confirmation: { enabled: true, title: "Confirm", body: "We'll look into this right away." },
      submit: { label: "Submit", thankYou: "Got it! Our support team will update you shortly." },
      crm: crm({ fieldMap: { order_number: "custom", issue: "custom", details: "custom" }, lifecycle: "customer", tags: ["Order enquiry"], assign: "auto" }),
    },
  },
};
export type FlowTemplateKey = keyof typeof FLOW_TEMPLATES;

export function blankDefinition(): FlowDefinition {
  return {
    start: { cta: "Open form", body: "Please fill in this short form." },
    screens: [{ title: "Your details", intro: "", fields: [f("full_name", "text", "Full name")], buttonLabel: "Continue" }],
    confirmation: { enabled: false, title: "", body: "" },
    submit: { label: "Submit", thankYou: "Thank you! We've received your details." },
    crm: crm({ fieldMap: { full_name: "name" } }),
  };
}

export const allFields = (d: FlowDefinition) => d.screens.flatMap((s) => s.fields);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateFlow(d: FlowDefinition): string[] {
  const errs: string[] = [];
  if (!d.start.cta.trim() || d.start.cta.length > LIMITS.cta) errs.push(`Start: button text is required (max ${LIMITS.cta} characters).`);
  if (!d.start.body.trim()) errs.push("Start: write the message sent with the form.");
  if (!d.screens.length) errs.push("Add at least one screen.");
  if (d.screens.length > LIMITS.screens) errs.push(`At most ${LIMITS.screens} screens.`);
  const names = new Set<string>();
  d.screens.forEach((s, i) => {
    const where = `Screen ${i + 1}`;
    if (!s.title.trim() || s.title.length > LIMITS.title) errs.push(`${where}: title is required (max ${LIMITS.title}).`);
    if (!s.fields.length) errs.push(`${where}: add at least one input or selection.`);
    if (s.fields.length > LIMITS.fieldsPerScreen) errs.push(`${where}: at most ${LIMITS.fieldsPerScreen} fields.`);
    if (!s.buttonLabel.trim() || s.buttonLabel.length > LIMITS.cta) errs.push(`${where}: button label is required (max ${LIMITS.cta}).`);
    for (const fl of s.fields) {
      const w = `${where} › “${fl.label || fl.name}”`;
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(fl.name)) errs.push(`${w}: field key must start with a letter and use a–z, 0–9, _.`);
      if (fl.name === "flow_token") errs.push(`${w}: “flow_token” is reserved.`);
      if (names.has(fl.name)) errs.push(`${w}: the key “${fl.name}” is used twice.`);
      names.add(fl.name);
      if (!fl.label.trim() || fl.label.length > LIMITS.label) errs.push(`${w}: label is required (max ${LIMITS.label}).`);
      if (fl.type === "dropdown" || fl.type === "radio" || fl.type === "checkbox") {
        const opts = fl.options.map((o) => o.trim()).filter(Boolean);
        if (opts.length < 2) errs.push(`${w}: add at least 2 options.`);
        if (opts.length > LIMITS.options) errs.push(`${w}: at most ${LIMITS.options} options.`);
        if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) errs.push(`${w}: options must be unique.`);
        if (opts.some((o) => o.length > LIMITS.option)) errs.push(`${w}: options are max ${LIMITS.option} characters.`);
      }
    }
  });
  if (d.confirmation.enabled && (!d.confirmation.title.trim() || d.confirmation.title.length > LIMITS.title)) errs.push("Confirmation: title is required.");
  if (!d.submit.label.trim() || d.submit.label.length > LIMITS.cta) errs.push(`Submit: button label is required (max ${LIMITS.cta}).`);
  const fields = allFields(d);
  const byName = new Map(fields.map((x) => [x.name, x]));
  for (const [k, v] of Object.entries(d.crm.fieldMap)) {
    if (v !== "ignore" && !byName.has(k)) errs.push(`CRM action: maps a field that no longer exists (${k}).`);
    if (v === "email" && byName.get(k) && byName.get(k)!.type !== "email") errs.push(`CRM action: only an Email field can update the contact's email.`);
  }
  if (Object.values(d.crm.fieldMap).filter((v) => v === "name").length > 1) errs.push("CRM action: only one field can set the contact name.");
  if (d.crm.consentField && byName.get(d.crm.consentField)?.type !== "optin") errs.push("CRM action: the consent field must be a consent checkbox.");
  const ap = d.crm.appointment;
  if (ap.enabled) {
    if (!ap.dateField || byName.get(ap.dateField)?.type !== "date") errs.push("CRM action: an appointment needs a Date field.");
    if (ap.serviceField && !byName.has(ap.serviceField)) errs.push("CRM action: the appointment service field doesn't exist.");
    if (ap.timeField && !byName.has(ap.timeField)) errs.push("CRM action: the appointment time field doesn't exist.");
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Meta Flow JSON
// ---------------------------------------------------------------------------

export const screenId = (i: number) => `SCREEN_${String.fromCharCode(65 + i)}`;
export const optionId = (o: string, i: number) => `${i}_${o.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "option"}`;

function component(fl: FlowField): Record<string, unknown> {
  const base = { name: fl.name, label: fl.label, required: fl.required };
  const source = fl.options.map((o, i) => ({ id: optionId(o, i), title: o }));
  switch (fl.type) {
    case "textarea":
      return { type: "TextArea", ...base };
    case "date":
      return { type: "DatePicker", ...base };
    case "dropdown":
      return { type: "Dropdown", ...base, "data-source": source };
    case "radio":
      return { type: "RadioButtonsGroup", ...base, "data-source": source };
    case "checkbox":
      return { type: "CheckboxGroup", ...base, "data-source": source };
    case "optin":
      return { type: "OptIn", ...base };
    default:
      return { type: "TextInput", ...base, "input-type": fl.type };
  }
}

const dataType = (fl: FlowField) =>
  fl.type === "checkbox" ? { type: "array", items: { type: "string" }, __example__: [] } : fl.type === "optin" ? { type: "boolean", __example__: false } : { type: "string", __example__: "" };

/** MECGURA definition → Meta Flow JSON (navigate between screens carrying answers; the last screen completes). */
export function toFlowJson(d: FlowDefinition): Record<string, unknown> {
  const screens: Record<string, unknown>[] = [];
  const confirm = d.confirmation.enabled;
  const total = d.screens.length + (confirm ? 1 : 0);
  let carried: FlowField[] = [];
  d.screens.forEach((s, i) => {
    const isLast = i === total - 1;
    const id = screenId(i);
    const payload = Object.fromEntries([...carried.map((x) => [x.name, `\${data.${x.name}}`]), ...s.fields.map((x) => [x.name, `\${form.${x.name}}`])]);
    const nextId = i + 1 < d.screens.length ? screenId(i + 1) : "CONFIRM";
    screens.push({
      id,
      title: s.title,
      ...(isLast ? { terminal: true, success: true } : {}),
      data: Object.fromEntries(carried.map((x) => [x.name, dataType(x)])),
      layout: {
        type: "SingleColumnLayout",
        children: [
          ...(s.intro.trim() ? [{ type: "TextBody", text: s.intro }] : []),
          ...s.fields.map(component),
          {
            type: "Footer",
            label: isLast ? d.submit.label : s.buttonLabel,
            "on-click-action": isLast ? { name: "complete", payload } : { name: "navigate", next: { type: "screen", name: nextId }, payload },
          },
        ],
      },
    });
    carried = [...carried, ...s.fields];
  });
  if (confirm) {
    const summary = carried.filter((x) => x.type !== "checkbox" && x.type !== "optin");
    screens.push({
      id: "CONFIRM",
      title: d.confirmation.title,
      terminal: true,
      success: true,
      data: Object.fromEntries(carried.map((x) => [x.name, dataType(x)])),
      layout: {
        type: "SingleColumnLayout",
        children: [
          ...(d.confirmation.body.trim() ? [{ type: "TextBody", text: d.confirmation.body }] : []),
          ...summary.flatMap((x) => [
            { type: "TextCaption", text: x.label },
            { type: "TextBody", text: `\${data.${x.name}}` },
          ]),
          { type: "Footer", label: d.submit.label, "on-click-action": { name: "complete", payload: Object.fromEntries(carried.map((x) => [x.name, `\${data.${x.name}}`])) } },
        ],
      },
    });
  }
  return { version: FLOW_JSON_VERSION, screens };
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export type Answers = Record<string, string | string[] | boolean>;

/** Meta response_json (or a demo form) → clean answers keyed by field, with option ids turned back into labels. */
export function normalizeAnswers(d: FlowDefinition, raw: Record<string, unknown>): { answers: Answers; errors: string[] } {
  const answers: Answers = {};
  const errors: string[] = [];
  for (const fl of allFields(d)) {
    const v = raw[fl.name];
    const toLabel = (x: unknown) => {
      const s = String(x ?? "");
      const i = fl.options.findIndex((o, k) => optionId(o, k) === s || o === s);
      return i >= 0 ? fl.options[i] : s;
    };
    if (fl.type === "checkbox") {
      const arr = (Array.isArray(v) ? v : v ? [v] : []).map(toLabel).filter((x) => fl.options.includes(x));
      if (fl.required && !arr.length) errors.push(`${fl.label} is required.`);
      answers[fl.name] = arr;
    } else if (fl.type === "optin") {
      const b = v === true || v === "true" || v === "on" || v === "yes";
      if (fl.required && !b) errors.push(`${fl.label} must be accepted.`);
      answers[fl.name] = b;
    } else {
      let s = (fl.type === "dropdown" || fl.type === "radio" ? toLabel(v) : String(v ?? "")).trim().slice(0, fl.type === "textarea" ? 2000 : 300);
      if (fl.type === "dropdown" || fl.type === "radio") {
        if (s && !fl.options.includes(s)) s = "";
      }
      if (fl.type === "email" && s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) errors.push(`${fl.label} isn't a valid email.`);
      if (fl.type === "number" && s && !/^-?\d+(\.\d+)?$/.test(s)) errors.push(`${fl.label} must be a number.`);
      if (fl.type === "date" && s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const n = Number(s); // some clients send epoch milliseconds
        if (Number.isFinite(n) && n > 0) s = new Date(n).toISOString().slice(0, 10);
        else errors.push(`${fl.label} must be a date.`);
      }
      if (fl.required && !s) errors.push(`${fl.label} is required.`);
      answers[fl.name] = s;
    }
  }
  return { answers, errors };
}

export function answerText(v: Answers[string]): string {
  return Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : v;
}

export function summarizeAnswers(d: FlowDefinition, a: Answers): string {
  return allFields(d)
    .map((fl) => `${fl.label}: ${answerText(a[fl.name] ?? "") || "—"}`)
    .join("\n");
}
