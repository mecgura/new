import { checkTemplate } from "@/lib/template-check";

/**
 * Explains a Meta template rejection in plain words and prepares an honest fixed copy. The fixes are mechanical
 * (format, spacing, the right category). It never rewrites a promotion to pass as a utility message.
 */
export type DoctorInput = { category: string; body: string; headerText: string; footer: string };
export type Diagnosis = {
  title: string;
  why: string;
  steps: string[];
  /** Changes the "fixed copy" makes on its own. Empty when everything needs a person. */
  changes: string[];
  fixed: { category: string; body: string };
};

const KNOWN: { test: RegExp; title: string; why: string; steps: string[] }[] = [
  {
    test: /INCORRECT[_ ]CATEGORY|TAG[_ ]CONTENT[_ ]MISMATCH|category/i,
    title: "Wrong category",
    why: "Meta read the message and decided it does not match the category you picked. This usually means a promotion was sent for review as Utility.",
    steps: ["Send offers, discounts and invitations to buy as Marketing.", "Keep Utility for updates about something the customer already did: an order, a booking, a payment, a reminder."],
  },
  {
    test: /INVALID[_ ]FORMAT|format|placeholder|variable|parameter/i,
    title: "Format problem",
    why: "Something in the layout breaks Meta's rules: usually the {{1}} variables, extra blank lines, or a missing sample value.",
    steps: ["Number variables {{1}}, {{2}}, {{3}} in order with none missing.", "Do not start or end the text with a variable, and put words between two variables.", "Give a realistic sample value for every variable when you submit."],
  },
  {
    test: /PROMOTIONAL|promot/i,
    title: "Promotional wording",
    why: "The text reads like an advertisement but was not submitted as Marketing.",
    steps: ["Submit it as Marketing, or remove the offer wording if it really is an update."],
  },
  {
    test: /ABUSIVE|SCAM|policy|prohibit|violat|threat|adult|gambl|alcohol|tobacco|drug/i,
    title: "Against Meta's policy",
    why: "Meta found wording or a product it does not allow on WhatsApp (for example threats, misleading claims, gambling, alcohol, tobacco, adult or medical claims).",
    steps: ["Remove the claim or product that breaks the policy. This cannot be fixed by rewording alone.", "Do not ask for card numbers, passwords or other sensitive details in a template."],
  },
  {
    test: /duplicate|already exists|same content/i,
    title: "Duplicate template",
    why: "Another template in your account has the same wording.",
    steps: ["Use the existing template, or change the wording so it is clearly different."],
  },
];

export function diagnoseRejection(reason: string, t: DoctorInput): Diagnosis {
  const verdict = checkTemplate(t.body);
  const known = KNOWN.find((k) => k.test.test(reason));
  const steps = [...(known?.steps ?? [])];
  const changes: string[] = [];
  let body = t.body;
  let category = t.category;

  if (verdict.category === "MARKETING" && t.category === "UTILITY") {
    category = "MARKETING";
    changes.push("Category changed from Utility to Marketing, because the text contains an offer.");
  }
  const tidy = body.replace(/\t/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (tidy !== body) {
    body = tidy;
    changes.push("Extra blank lines, tabs and spaces removed.");
  }
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(body)) {
    body = `Hello ${body.trimStart()}`;
    changes.push("Added “Hello” so the text no longer starts with a variable.");
  }
  if (/\{\{\s*\d+\s*\}\}\s*$/.test(body)) {
    body = `${body.trimEnd()}.`;
    changes.push("Added a full stop so the text no longer ends with a variable.");
  }
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(body)) {
    body = body.replace(/(\{\{\s*\d+\s*\}\})\s*(?=\{\{\s*\d+\s*\}\})/g, "$1, ");
    changes.push("Put a comma between variables that sat side by side.");
  }
  for (const w of checkTemplate(body).warnings) if (!steps.includes(w)) steps.push(w);

  return {
    title: known?.title ?? (reason ? "Rejected by Meta" : "Rejected without a reason"),
    why: known?.why ?? (reason ? `Meta's note: “${reason}”. The points below are the usual causes.` : "Meta did not give a reason. The points below are the usual causes."),
    steps: steps.length ? steps : ["Check that the category matches the purpose, the variables are numbered in order, and every variable has a sample value."],
    changes,
    fixed: { category, body },
  };
}
