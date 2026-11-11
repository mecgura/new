import type { MedicineHit, MedicineSource } from "@/lib/integrations/medicines";

/**
 * Online medicine names from RxNorm (U.S. National Library of Medicine, RxNav REST API: https://lhncbc.nlm.nih.gov/RxNav/APIs/).
 * RxNorm is a public-domain drug vocabulary and the API needs no licence or key. Only the text the user typed is sent: never a patient name or any
 * clinic data. RxNorm covers products sold in the United States: many Indian brands (Dolo, Crocin...) are NOT in it, and generics appear under
 * their US names (we show the international name where we know it). Results are suggestions to pre-fill a form; nothing here says a drug is safe.
 */
const BASE = (process.env.RXNAV_BASE_URL || "https://rxnav.nlm.nih.gov/REST").replace(/\/$/, "");
const TIMEOUT_MS = 4500;
export const RXNORM_ATTRIBUTION = "Source: RxNorm, U.S. National Library of Medicine";

/** US names → the international (INN) names used in India. Display only. */
const INN: Record<string, string> = { acetaminophen: "Paracetamol", albuterol: "Salbutamol", epinephrine: "Adrenaline", norepinephrine: "Noradrenaline", meperidine: "Pethidine", rifampin: "Rifampicin", "cyclosporine": "Ciclosporin", furosemide: "Furosemide", "hydrochlorothiazide": "Hydrochlorothiazide", "phenobarbital": "Phenobarbitone", "acetaminophen / codeine": "Paracetamol / Codeine", "amoxicillin / clavulanate": "Amoxicillin / Clavulanic acid" };
const FORM_WORDS = "Oral Tablet|Chewable Tablet|Delayed Release Oral Tablet|Extended Release Oral Tablet|Disintegrating Oral Tablet|Oral Capsule|Delayed Release Oral Capsule|Extended Release Oral Capsule|Oral Solution|Oral Suspension|Oral Syrup|Injectable Solution|Injectable Suspension|Injection|Topical Cream|Topical Ointment|Topical Gel|Topical Lotion|Topical Solution|Ophthalmic Solution|Ophthalmic Ointment|Otic Solution|Nasal Spray|Metered Dose Inhaler|Inhalant Solution|Rectal Suppository|Vaginal Cream|Transdermal System|Oral Powder|Powder for Oral Solution|Granules|Chewable Gum|Lozenge";

interface Concept { rxcui?: string; name?: string; tty?: string }
const isConcept = (c: unknown): c is Concept => typeof c === "object" && c !== null && typeof (c as Concept).name === "string";
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "acetaminophen 500 MG Oral Tablet [Tylenol]" → generic / strength / form / brand. Unparseable names are returned whole, never dropped. */
export function parseRxName(raw: string): MedicineHit {
  const brandM = /\[([^\]]+)\]\s*$/.exec(raw); const brand = brandM ? brandM[1].trim() : null;
  let rest = brandM ? raw.slice(0, brandM.index).trim() : raw.trim();
  const formM = new RegExp(`\\s(${FORM_WORDS})\\s*$`, "i").exec(rest); const form = formM ? formM[1] : null; if (formM) rest = rest.slice(0, formM.index).trim();
  const strengthM = /(\d[\d.,]*\s*(?:MG|MCG|G|ML|IU|UNT|MEQ|%|ACTUAT|HR)(?:\s*\/\s*\d*[\d.]*\s*(?:MG|MCG|G|ML|HR|ACTUAT))?)(?:\s+(?:and\s+)?\d[\d.,]*\s*(?:MG|MCG|G|ML|IU|UNT|MEQ|%)(?:\s*\/\s*\d*[\d.]*\s*(?:MG|MCG|G|ML))?)*/i.exec(rest);
  const generic = (strengthM ? rest.slice(0, strengthM.index).trim() : rest).replace(/\s+\/\s*$/, "").trim();
  const strength = strengthM ? rest.slice(strengthM.index).trim().replace(/\s+/g, " ") : null;
  const key = generic.toLowerCase();
  const display = INN[key] ?? generic.split(" / ").map((g) => INN[g.toLowerCase()] ?? cap(g)).join(" / ");
  return { name: raw, genericName: display || raw, brandName: brand, strength, form };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "MECGURA-HEALTH/1.0 (medicine name lookup)" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`RxNav ${res.status}`);
  return res.json();
}
const conceptsOf = (groups: unknown): Concept[] => (Array.isArray(groups) ? groups : []).flatMap((g) => { const p = (g as { conceptProperties?: unknown }).conceptProperties; return Array.isArray(p) ? p.filter(isConcept) : []; });

const cache = new Map<string, { at: number; hits: MedicineHit[] }>();
const TTL = 10 * 60_000;

export const rxNormSource: MedicineSource = {
  name: "RxNorm (NLM)",
  async search(query, limit) {
    const q = query.trim().toLowerCase().slice(0, 60); if (q.length < 2) return [];
    const hit = cache.get(q); if (hit && Date.now() - hit.at < TTL) return hit.hits.slice(0, limit);
    let concepts: Concept[] = [];
    const direct = (await getJson(`${BASE}/drugs.json?name=${encodeURIComponent(q)}`)) as { drugGroup?: { conceptGroup?: unknown } };
    concepts = conceptsOf(direct?.drugGroup?.conceptGroup).filter((c) => c.tty === "SBD" || c.tty === "SCD");
    if (!concepts.length) { // e.g. "paracetamol": RxNorm calls it acetaminophen. Resolve the term, then list that drug's products.
      const approx = (await getJson(`${BASE}/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=3`)) as { approximateGroup?: { candidate?: { rxcui?: string }[] } };
      const ids = [...new Set((approx?.approximateGroup?.candidate ?? []).map((c) => c.rxcui).filter((x): x is string => !!x && /^\d+$/.test(x)))].slice(0, 2);
      const related = await Promise.all(ids.map((id) => getJson(`${BASE}/rxcui/${id}/related.json?tty=SCD+SBD`).catch(() => null) as Promise<{ relatedGroup?: { conceptGroup?: unknown } } | null>));
      concepts = related.flatMap((r) => conceptsOf(r?.relatedGroup?.conceptGroup)).filter((c) => c.tty === "SBD" || c.tty === "SCD");
    }
    const seen = new Set<string>(); const hits: MedicineHit[] = [];
    for (const c of concepts) { const n = (c.name ?? "").trim(); if (!n || n.length > 200 || seen.has(n.toLowerCase())) continue; seen.add(n.toLowerCase()); hits.push(parseRxName(n)); if (hits.length >= 40) break; }
    cache.set(q, { at: Date.now(), hits }); if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    return hits.slice(0, limit);
  },
};
