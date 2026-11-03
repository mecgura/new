import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getFestivals } from "@/services/site/festivals";

/**
 * MECGURA's own content calendar. Posts are planned per India date; "Auto plan" fills empty days of a month with a
 * ready mix (tips, features, proof, offers) plus a post a few days before every festival, so the month is never blank.
 */
export const CHANNELS = ["instagram", "facebook", "whatsapp_status", "linkedin"] as const;
export const FORMATS = ["post", "story", "reel", "status"] as const;
export const POST_STATUSES = ["idea", "ready", "posted"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
export const postSchema = z
  .object({
    date: isoDate,
    channels: z.array(z.enum(CHANNELS)).min(1).max(4).default(["instagram"]),
    title: z.string().trim().min(1, "Give it a title").max(120),
    caption: z.string().trim().max(2200).default(""),
    format: z.enum(FORMATS).default("post"),
    status: z.enum(POST_STATUSES).default("idea"),
    festival: z.string().trim().max(60).default(""),
  })
  .strict();
// No defaults on edit: a field that isn't sent stays as it is.
export const postPatchSchema = z
  .object({
    date: isoDate,
    channels: z.array(z.enum(CHANNELS)).min(1).max(4),
    title: z.string().trim().min(1, "Give it a title").max(120),
    caption: z.string().trim().max(2200),
    format: z.enum(FORMATS),
    status: z.enum(POST_STATUSES),
    festival: z.string().trim().max(60),
  })
  .partial()
  .strict();
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month");

const dto = (p: Awaited<ReturnType<typeof db.marketingPost.findFirstOrThrow>>) => ({ ...p, channels: JSON.parse(p.channels) as string[] });

export async function listMonth(month: string) {
  const posts = await db.marketingPost.findMany({ where: { date: { startsWith: `${month}-` } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  const fest = await getFestivals();
  const festivals = fest.festivals.filter((f) => f.start.startsWith(month)).map((f) => ({ id: f.id, name: f.name, emoji: f.emoji, date: f.start }));
  return { month, posts: posts.map(dto), festivals };
}

export async function createPost(input: z.infer<typeof postSchema>, actorId: string, req?: Request) {
  const p = await db.marketingPost.create({ data: { ...input, channels: JSON.stringify(input.channels) } });
  await audit({ action: "marketing.post_saved", actorUserId: actorId, targetType: "marketing_post", targetId: p.id, metadata: { date: p.date }, req });
  return dto(p);
}

export async function updatePost(id: string, patch: z.infer<typeof postPatchSchema>, actorId: string, req?: Request) {
  if (!(await db.marketingPost.count({ where: { id } }))) throw new ApiError("NOT_FOUND", "Post not found.");
  const { channels, ...rest } = patch;
  const p = await db.marketingPost.update({ where: { id }, data: { ...rest, ...(channels ? { channels: JSON.stringify(channels) } : {}) } });
  await audit({ action: "marketing.post_saved", actorUserId: actorId, targetType: "marketing_post", targetId: id, metadata: { fields: Object.keys(patch) }, req });
  return dto(p);
}

export async function deletePost(id: string, actorId: string, req?: Request) {
  const r = await db.marketingPost.deleteMany({ where: { id } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Post not found.");
  await audit({ action: "marketing.post_saved", actorUserId: actorId, targetType: "marketing_post", targetId: id, metadata: { deleted: true }, req });
}

// ---------------------------------------------------------------------------
// Auto plan
// ---------------------------------------------------------------------------
type Idea = { title: string; caption: string; format: (typeof FORMATS)[number] };

const TIPS: Idea[] = [
  { title: "Tip: reply in 5 minutes", format: "post", caption: "Customer ne WhatsApp kitta te 2 ghante baad reply? Sale gayi 😅\nAuto-reply naal har message da jawab turant, din raat.\n\nFree demo: WhatsApp 78377 22567" },
  { title: "Tip: broadcast without getting blocked", format: "post", caption: "Broadcast bhejde ho te number block ho jaanda? 🚫\nOfficial WhatsApp API naal approved templates te opt-in customers nu hi message, number safe.\n\nPuchho: 78377 22567" },
  { title: "Tip: never lose a lead", format: "reel", caption: "Instagram ad ton lead aayi, par follow-up bhul gaye? 🤦\nMECGURA har lead nu aap WhatsApp te message karda hai, 1 minute ch.\n\nDemo layi DM karo" },
  { title: "Tip: festival message to all customers", format: "post", caption: "Festival te 1000 customers nu ik-ik karke wish? Nahi ji 🙏\nIk click ch sab nu personal naam naal message.\n\nWhatsApp: 78377 22567" },
  { title: "Tip: catalogue on WhatsApp", format: "story", caption: "Customer puchhda \"rate ki hai?\" 🤔\nAuto-reply ch catalogue te price list, team da time bachda.\n\nSwipe up / DM" },
];
const FEATURES: Idea[] = [
  { title: "Feature: shared team inbox", format: "post", caption: "Ik WhatsApp number, poori team 👥\nSab chats ikko inbox ch, kaun reply kar reha sab nu pata.\n\nMECGURA · mecgura.tech" },
  { title: "Feature: click-to-WhatsApp ads", format: "reel", caption: "Ad te click → seedha WhatsApp chat → auto reply 🚀\nLeads waste nahi hundiyan.\n\nFree demo: 78377 22567" },
  { title: "Feature: automation flows", format: "post", caption: "Welcome message, reminder, follow-up, feedback… sab aap 🤖\nTusi business sambhalo, WhatsApp MECGURA sambhalega.\n\nmecgura.tech" },
  { title: "Feature: green tick help", format: "story", caption: "Blue/green tick chahida hai? ✅\nOfficial Business Account di application ch asi madad karde haan.\n\nDM karo" },
  { title: "Feature: use your existing number", format: "post", caption: "Purana number chhadna nahi painda 📱\nWhatsApp Business App naal hi API vi chal sakdi hai (Meta eligibility).\n\nPuchho: 78377 22567" },
];
const PROOF: Idea[] = [
  { title: "Proof: this month's numbers", format: "post", caption: "Is mahine MECGURA ton clients ne [X] WhatsApp messages bheje, [Y]% read hoye 📈\n(Creative maker → Proof card naal real numbers wala post banao)\n\nTuhada business agla ho sakda 🙌" },
  { title: "Client story", format: "reel", caption: "Ik local business ne WhatsApp automation laaun ton baad ki badlya? 🎯\n(Client di permission naal unhan di kahani)\n\nDemo: 78377 22567" },
];
const OFFERS: Idea[] = [
  { title: "Offer: free setup this week", format: "post", caption: "Is hafte setup bilkul free 🎁\nNumber connect, templates te pehli automation, sab asi karange.\n\nWhatsApp: 78377 22567" },
  { title: "Software vs full solution", format: "post", caption: "Sirf software chahiye ja poora solution? 🤔\nSetup, support te ready automations, MECGURA naal.\n\n(Creative maker → Comparison)" },
];

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Fills a month's empty days: Mon tip, Wed feature, Fri proof/offer, a story every Sunday, and festival posts. */
export async function autoPlan(month: string, actorId: string, req?: Request) {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const taken = new Set((await db.marketingPost.findMany({ where: { date: { startsWith: `${month}-` } }, select: { date: true } })).map((p) => p.date));
  const fest = await getFestivals();
  const planned: { date: string; idea: Idea; festival?: string }[] = [];

  // Festivals first: a teaser 3 days before (when in this month) and a wish on the day.
  for (const f of fest.festivals) {
    const teaser = addDays(f.start, -3);
    if (teaser.startsWith(month)) planned.push({ date: teaser, festival: f.name, idea: { title: `${f.name} offer teaser`, format: "post", caption: `${f.emoji} ${f.name} aa reha hai!\n${f.discountPercent ? `${f.discountPercent}% off on MECGURA plans` : "Special offer on MECGURA plans"}${f.offerCode ? ` · code ${f.offerCode}` : ""}.\nApne customers nu ${f.name} te WhatsApp te wish karo, ik click ch.\n\nWhatsApp: 78377 22567` } });
    if (f.start.startsWith(month)) planned.push({ date: f.start, festival: f.name, idea: { title: `${f.name} wishes`, format: "post", caption: `${f.emoji} Happy ${f.name}!\nTeam MECGURA vallon tuhanu te tuhade parivar nu ${f.name} diyan lakh lakh vadhaiyan 🙏` } });
  }

  let t = 0, fe = 0, pr = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (planned.some((p) => p.date === date)) continue;
    if (dow === 1) planned.push({ date, idea: TIPS[t++ % TIPS.length] });
    else if (dow === 3) planned.push({ date, idea: FEATURES[fe++ % FEATURES.length] });
    else if (dow === 5) planned.push({ date, idea: [...PROOF, ...OFFERS][pr++ % (PROOF.length + OFFERS.length)] });
    else if (dow === 0) planned.push({ date, idea: { ...TIPS[(t + 2) % TIPS.length], format: "story", title: `Story: ${TIPS[(t + 2) % TIPS.length].title.replace(/^Tip: /, "")}` } });
  }

  const fresh = planned.filter((p) => !taken.has(p.date));
  if (fresh.length) {
    await db.marketingPost.createMany({
      data: fresh.map((p) => ({ date: p.date, title: p.idea.title, caption: p.idea.caption, format: p.idea.format, festival: p.festival ?? "", channels: JSON.stringify(p.idea.format === "story" ? ["instagram", "whatsapp_status"] : ["instagram", "facebook"]) })),
    });
  }
  await audit({ action: "marketing.post_saved", actorUserId: actorId, targetType: "marketing_post", metadata: { autoPlan: month, added: fresh.length }, req });
  return { added: fresh.length, ...(await listMonth(month)) };
}
