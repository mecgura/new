/**
 * A rough, rule-based check of a WhatsApp template's wording. It only EXPLAINS likely problems and the likely category;
 * Meta decides the real category, and it re-categorises promotions that are written as utility. Nothing here helps hide a promotion.
 */
export type Verdict = { category: "MARKETING" | "UTILITY" | "AUTHENTICATION" | "UNSURE"; reasons: string[]; warnings: string[]; ok: string[] };

const PROMO = [/\b\d{1,3}\s?%/i, /\b(off|discount|sale|offer|deal|coupon|cashback|voucher|free|save|bonus)\b/i, /\b(limited|hurry|last chance|today only|only today|ending soon|don'?t miss|grab|exclusive)\b/i, /\b(buy|shop now|order now|book now|visit us|new arrival|launch|festival|diwali|holi|baisakhi|christmas|eid)\b/i, /\b(refer|share this|invite)\b/i];
const UTILITY = [/\b(order|booking|appointment|reservation|ticket|request)\b[^.]{0,30}\b(confirmed|received|placed|scheduled|updated|ready|shipped|delivered|rescheduled|cancelled)\b/i, /\b(payment|invoice|receipt|bill)\b/i, /\b(reminder|due|expires?|renewal|delivery|out for delivery|tracking)\b/i, /\b(your)\b[^.]{0,20}\b(order|booking|appointment|payment|account|request)\b/i];
const OTP = /\b(otp|verification code|one[- ]time|login code|passcode)\b/i;

export function checkTemplate(body: string): Verdict {
  const t = body.trim();
  const reasons: string[] = [];
  const warnings: string[] = [];
  const ok: string[] = [];
  if (!t) return { category: "UNSURE", reasons: [], warnings: ["Paste your template text."], ok };

  const promo = PROMO.filter((r) => r.test(t)).length;
  const util = UTILITY.filter((r) => r.test(t)).length;
  const otp = OTP.test(t);
  let category: Verdict["category"] = "UNSURE";
  if (otp && promo === 0) {
    category = "AUTHENTICATION";
    reasons.push("It looks like a verification code (OTP).");
  } else if (promo >= 1 && promo >= util) {
    category = "MARKETING";
    reasons.push("It contains promotional wording (offer, discount, free, limited time, or an invitation to buy).");
    if (util) reasons.push("It also mentions an update about something the customer did. Mixing a promotion into an update still makes it a marketing template.");
  } else if (util >= 1) {
    category = "UTILITY";
    reasons.push("It looks like an update about something the customer already did (order, booking, payment, reminder).");
  } else reasons.push("No clear signals either way. Meta decides based on the real purpose of the message.");

  // Format checks (Meta rejects templates that break these).
  const vars = [...t.matchAll(/\{\{\s*(\d+)\s*\}\}/g)];
  const nums = vars.map((m) => Number(m[1]));
  const max = Math.max(0, ...nums);
  if (new Set(nums).size !== max || nums.some((n) => n < 1)) warnings.push("Variables must be numbered {{1}}, {{2}}, {{3}} in order with none missing.");
  else if (vars.length) ok.push(`${new Set(nums).size} variable(s), numbered correctly.`);
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(t)) warnings.push("The text starts with a variable. Meta usually rejects that. Start with a word.");
  if (/\{\{\s*\d+\s*\}\}\s*[.!?]?\s*$/.test(t)) warnings.push("The text ends with a variable. Meta usually rejects that. End with a word or full stop.");
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(t)) warnings.push("Two variables sit side by side. Put words between them.");
  if (vars.length && t.replace(/\{\{\s*\d+\s*\}\}/g, "").trim().length < vars.length * 12) warnings.push("Too many variables for so little text. Add more fixed wording around them.");
  if (t.length > 1024) warnings.push(`The body is ${t.length} characters. The limit is 1024.`);
  else ok.push(`${t.length}/1024 characters.`);
  if (/\n{3,}/.test(t) || /\t/.test(t) || / {5,}/.test(t)) warnings.push("Remove extra blank lines, tabs or long runs of spaces.");
  if (/(bit\.ly|tinyurl|goo\.gl|t\.co\/|cutt\.ly|rb\.gy)/i.test(t)) warnings.push("Link shorteners (bit.ly and similar) are often rejected. Use your full website link.");
  if (/\b(guaranteed|100% (safe|sure)|risk[- ]free|get rich|lottery|winner)\b/i.test(t)) warnings.push("Risky claims such as “guaranteed” or “winner” can get a template rejected.");
  if (/[A-Z]{12,}/.test(t.replace(/\{\{\d+\}\}/g, ""))) warnings.push("Avoid long ALL CAPS text.");
  if (category === "MARKETING") ok.push("Send marketing templates only to customers who opted in, and include an easy way to say STOP.");
  return { category, reasons, warnings, ok };
}

export type OptInInput = { business: string; where: "counter" | "qr" | "website" | "ad_chat"; sends: ("offers" | "orders" | "reminders")[]; language: "english" | "hinglish"; frequency: string };

/** Ready-to-use opt-in wording. It always says who you are, what you'll send, how often, and how to stop. */
export function optInTexts(i: OptInInput) {
  const biz = i.business.trim() || "our business";
  const what = { offers: "offers", orders: "order updates", reminders: "reminders" };
  const list = i.sends.length ? i.sends.map((s) => what[s]) : ["updates"];
  const whatEn = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
  const whatHi = whatEn.replace("offers", "offers").replace("order updates", "order updates").replace(" and ", " aur ");
  const freq = i.frequency.trim() || "a few times a month";
  const hi = i.language === "hinglish";
  const ask = hi
    ? `Kya ${biz} aapko WhatsApp par ${whatHi} bhej sakta hai? Hum ${freq} message bhejenge. Kabhi bhi STOP likhkar band kar sakte hain. Haan ke liye YES likhein.`
    : `May ${biz} send you ${whatEn} on WhatsApp? We will message about ${freq}. You can reply STOP at any time. Reply YES to agree.`;
  const checkbox = hi
    ? `Main chahta/chahti hoon ki ${biz} mujhe WhatsApp par ${whatHi} bheje. Main kabhi bhi STOP likhkar ise band kar sakta/sakti hoon.`
    : `I agree that ${biz} may send me ${whatEn} on WhatsApp. I can reply STOP at any time.`;
  const confirm = hi ? `Dhanyavaad! Ab aapko ${biz} se ${whatHi} milenge. Rukne ke liye kabhi bhi STOP likhein.` : `Thank you! You will now get ${whatEn} from ${biz}. Reply STOP any time to opt out.`;
  const stop = hi ? "Rukne ke liye STOP likhein." : "Reply STOP to opt out.";
  const where = { counter: hi ? "Billing counter par bolein ya sign-up sheet par likhwayein." : "Say it at the billing counter or on a sign-up sheet.", qr: hi ? "QR scan karne par customer khud message karta hai. Ye sabse mazboot opt-in hai." : "When a customer scans and messages you, that is the strongest opt-in.", website: hi ? "Form mein number ke saath ye checkbox lagayein (pehle se tick na karein)." : "Put this checkbox next to the number field on your form (never pre-ticked).", ad_chat: hi ? "Customer ke pehle message ke baad ye sawaal poochein." : "Ask this after the customer's first message." }[i.where];
  return { ask, checkbox, confirm, stop, where };
}
