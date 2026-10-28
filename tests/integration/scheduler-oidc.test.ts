import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { db } from "@/lib/db";
import * as cron from "@/app/api/cron/campaigns/route";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" };
const realFetch = globalThis.fetch;

const b64u = (v: string | Buffer) => Buffer.from(v).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function token(claims: Record<string, unknown>, kid = "test-kid") {
  const head = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  return `${head}.${body}.${b64u(sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey))}`;
}
const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ iss: "https://token.actions.githubusercontent.com", aud: "mecgura-scheduler", repository: "mecgura/new", event_name: "schedule", exp: now() + 300, nbf: now() - 5 });
const call = (t: string) => cron.GET(new Request("http://localhost/api/cron/campaigns", { headers: { authorization: `Bearer ${t}` } }));

afterEach(() => vi.restoreAllMocks());

describe("scheduler called by the GitHub Actions workflow", () => {
  it("accepts only GitHub-signed tokens for this repository and audience", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).includes("token.actions.githubusercontent.com")) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      return realFetch(url, init);
    });
    const ok = await call(token(good()));
    expect(ok.status).toBe(200);
    expect((await ok.json()).via).toBe("github");
    expect((await call(token({ ...good(), repository: "someone/fork" }))).status).toBe(401);
    expect((await call(token({ ...good(), aud: "other" }))).status).toBe(401);
    expect((await call(token({ ...good(), exp: now() - 600 }))).status).toBe(401);
    expect((await call(token(good(), "unknown-kid"))).status).toBe(401);
    // A token signed with a different key is refused.
    const forged = token(good()).split(".");
    forged[2] = b64u("not-a-signature");
    expect((await call(forged.join("."))).status).toBe(401);
  });
});

describe("backup scheduler tick", () => {
  it("only one instance claims a tick per minute", async () => {
    const { claimTick } = await import("@/services/scheduler-tick");
    await db.siteSetting.deleteMany({ where: { key: "scheduler:lastTick" } });
    const now = Date.now();
    expect(await claimTick(now)).toBe(true);
    expect(await claimTick(now + 1_000)).toBe(false);
    // A minute after the last claim, the next tick can run.
    expect(await claimTick(now + 2 * 60_000)).toBe(true);
  });
});
