import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e?.code ?? `ERR:${e}`); // modules are reloaded in these tests, so compare codes rather than class identity
let admin: ReturnType<typeof asTenant>, recep: ReturnType<typeof asTenant>, sa: ReturnType<typeof asTenant>;
beforeAll(async () => {
  await seedSystemData();
  const t = await db.tenant.create({ data: { name: "Online med", slug: uniq("om").slice(0, 30), status: "ACTIVE" } });
  admin = asTenant(ctxFor((await makeUser("CLINIC_ADMIN", t.id)).user, "CLINIC_ADMIN", t.id));
  recep = asTenant(ctxFor((await makeUser("RECEPTIONIST", t.id)).user, "RECEPTIONIST", t.id));
  sa = asTenant(ctxFor((await makeUser("SUPER_ADMIN", null)).user, "SUPER_ADMIN", t.id));
});

describe("online medicine search (opt-in)", () => {
  it("is off unless MEDICINE_ONLINE_SEARCH=rxnorm: nothing is sent anywhere", async () => {
    vi.resetModules(); vi.stubEnv("MEDICINE_ONLINE_SEARCH", "");
    const f = vi.spyOn(globalThis, "fetch");
    const { searchOnlineMedicines } = await import("./medicines");
    expect(await searchOnlineMedicines(admin, "paracetamol")).toMatchObject({ enabled: false, items: [] });
    expect(f).not.toHaveBeenCalled(); f.mockRestore(); vi.unstubAllEnvs();
  });
  it("when on, returns attributed suggestions, only for users who manage medicines, and never for a Super Admin", async () => {
    vi.resetModules(); vi.stubEnv("MEDICINE_ONLINE_SEARCH", "rxnorm");
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ drugGroup: { conceptGroup: [{ tty: "SCD", conceptProperties: [{ name: "ibuprofen 400 MG Oral Tablet", tty: "SCD" }] }] } }), { status: 200 })));
    const { searchOnlineMedicines } = await import("./medicines");
    const r = await searchOnlineMedicines(admin, "ibuprofen");
    expect(r.enabled).toBe(true); expect(r.attribution).toMatch(/RxNorm/); expect(r.items[0]).toMatchObject({ genericName: "Ibuprofen", strength: "400 MG" });
    expect(String(f.mock.calls[0][0])).not.toMatch(/patient|clinic|tenant/i); // only the typed text goes out
    expect(await code(searchOnlineMedicines(recep, "ibuprofen"))).toBe("FORBIDDEN"); expect(await code(searchOnlineMedicines(sa, "ibuprofen"))).toBe("FORBIDDEN");
    f.mockImplementation(() => Promise.resolve(new Response("x", { status: 500 }))); expect(await code(searchOnlineMedicines(admin, "ibuprofen2"))).toBe("INTERNAL");
    f.mockRestore(); vi.unstubAllEnvs();
  });
});
