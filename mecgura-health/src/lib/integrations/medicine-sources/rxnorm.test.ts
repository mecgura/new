import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRxName, rxNormSource } from "./rxnorm";

// The live RxNav API can't be reached from the build environment, so these tests use responses shaped like the documented API (drugs.json / approximateTerm.json / related.json).
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
afterEach(() => vi.restoreAllMocks());

describe("parseRxName", () => {
  it("splits generic, strength, form and brand, and shows the international name", () => {
    expect(parseRxName("acetaminophen 500 MG Oral Tablet [Tylenol]")).toMatchObject({ genericName: "Paracetamol", strength: "500 MG", form: "Oral Tablet", brandName: "Tylenol" });
    expect(parseRxName("amoxicillin 250 MG Oral Capsule")).toMatchObject({ genericName: "Amoxicillin", strength: "250 MG", form: "Oral Capsule", brandName: null });
    expect(parseRxName("cetirizine hydrochloride 10 MG Oral Tablet")).toMatchObject({ genericName: "Cetirizine hydrochloride", strength: "10 MG", form: "Oral Tablet" });
    expect(parseRxName("amoxicillin 500 MG / clavulanate 125 MG Oral Tablet")).toMatchObject({ genericName: "Amoxicillin", form: "Oral Tablet" });
  });
  it("never drops a name it cannot parse", () => { expect(parseRxName("Some Odd Product")).toMatchObject({ name: "Some Odd Product", genericName: "Some Odd Product" }); });
});

describe("rxNormSource.search", () => {
  it("returns de-duplicated product names from drugs.json", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(() => json({ drugGroup: { name: "amoxicillin", conceptGroup: [{ tty: "BN", conceptProperties: [{ rxcui: "1", name: "Amoxil", tty: "BN" }] }, { tty: "SCD", conceptProperties: [{ rxcui: "2", name: "amoxicillin 500 MG Oral Capsule", tty: "SCD" }, { rxcui: "3", name: "amoxicillin 500 MG Oral Capsule", tty: "SCD" }] }, { tty: "SBD", conceptProperties: [{ rxcui: "4", name: "amoxicillin 250 MG Oral Capsule [Amoxil]", tty: "SBD" }] }] } }));
    const hits = await rxNormSource.search("amoxicillin x1", 10);
    expect(hits.map((h) => h.name)).toEqual(["amoxicillin 500 MG Oral Capsule", "amoxicillin 250 MG Oral Capsule [Amoxil]"]);
    expect(hits[1].brandName).toBe("Amoxil"); expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("drugs.json?name=amoxicillin%20x1");
  });
  it("falls back to approximate matching when the name isn't an RxNorm name (e.g. paracetamol)", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((u) => {
      const url = String(u); calls.push(url);
      if (url.includes("drugs.json")) return json({ drugGroup: { name: "paracetamol" } });
      if (url.includes("approximateTerm")) return json({ approximateGroup: { inputTerm: "paracetamol", candidate: [{ rxcui: "161", score: "100", rank: "1" }, { rxcui: "161", score: "90", rank: "2" }, { rxcui: "not-a-number" }] } });
      if (url.includes("/rxcui/161/related.json")) return json({ relatedGroup: { conceptGroup: [{ tty: "SCD", conceptProperties: [{ rxcui: "9", name: "acetaminophen 500 MG Oral Tablet", tty: "SCD" }] }] } });
      return json({});
    });
    const hits = await rxNormSource.search("paracetamol fallback", 5);
    expect(hits).toHaveLength(1); expect(hits[0]).toMatchObject({ genericName: "Paracetamol", strength: "500 MG" });
    expect(calls.filter((c) => c.includes("related.json"))).toHaveLength(1); // duplicate / non-numeric ids are not queried
  });
  it("copes with empty and malformed responses, short queries, and caches repeats", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(() => json({ unexpected: true }));
    expect(await rxNormSource.search("zzzzqq", 5)).toEqual([]);
    expect(await rxNormSource.search("a", 5)).toEqual([]);
    const before = f.mock.calls.length; await rxNormSource.search("zzzzqq", 5); expect(f.mock.calls.length).toBe(before);
  });
  it("rejects when the service is down (the caller shows a friendly message)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("nope", { status: 503 })));
    await expect(rxNormSource.search("downtime", 5)).rejects.toThrow();
  });
});
