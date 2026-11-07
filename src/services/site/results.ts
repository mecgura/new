import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * Case studies for /results, written by the Super Admin from real client work. Nothing is shown until an entry is
 * published, and an entry can only be published after the admin confirms the client agreed to it.
 */
const KEY = "site:results";
const t = (max: number) => z.string().trim().max(max).default("");

export const caseStudySchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, "Lowercase letters, numbers and dashes"),
  business: z.string().trim().min(2, "Business name").max(80),
  type: t(60),
  city: t(60),
  challenge: z.string().trim().min(10, "Describe the problem").max(400),
  solution: z.string().trim().min(10, "Describe what you set up").max(500),
  results: z.array(z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(30) })).max(4).default([]),
  quote: t(300),
  quoteBy: t(80),
  clientApproved: z.boolean().default(false),
  published: z.boolean().default(false),
});
export type CaseStudy = z.infer<typeof caseStudySchema>;
export const resultsSchema = z.object({ items: z.array(caseStudySchema).max(30) }).superRefine((v, ctx) => {
  v.items.forEach((c, i) => {
    if (c.published && !c.clientApproved) ctx.addIssue({ code: "custom", path: ["items", i, "published"], message: "Confirm the client agreed before publishing" });
    if (c.quote && !c.quoteBy) ctx.addIssue({ code: "custom", path: ["items", i, "quoteBy"], message: "Say who said it" });
  });
});

export async function getResults(): Promise<CaseStudy[]> {
  try {
    const p = resultsSchema.safeParse(JSON.parse(await getSetting(KEY, "")));
    return p.success ? p.data.items : [];
  } catch {
    return [];
  }
}
export const getPublishedResults = async () => (await getResults()).filter((c) => c.published && c.clientApproved);
export async function saveResults(input: z.infer<typeof resultsSchema>) {
  await setSetting(KEY, JSON.stringify(input));
  return input.items;
}
