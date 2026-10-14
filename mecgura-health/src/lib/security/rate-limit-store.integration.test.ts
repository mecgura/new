import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DbStore, pruneRateLimits } from "./rate-limit";

// The production store: counters live in the database so every serverless instance sees the same numbers.
describe("database rate-limit store", () => {
  it("counts hits inside a window and is shared between store instances (= between serverless instances)", async () => {
    const a = new DbStore(); const b = new DbStore(); const key = `t:${Math.random()}`;
    expect((await a.hit(key, 60_000)).count).toBe(1);
    expect((await b.hit(key, 60_000)).count).toBe(2);
    expect((await a.hit(key, 60_000)).count).toBe(3);
  });
  it("starts a new window once the old one has expired, and counts concurrent hits exactly", async () => {
    const s = new DbStore(); const key = `t:${Math.random()}`;
    await s.hit(key, 60_000); await db.rateLimitBucket.update({ where: { key }, data: { resetAt: new Date(Date.now() - 1000) } });
    expect((await s.hit(key, 60_000)).count).toBe(1);
    const k2 = `t:${Math.random()}`; await s.hit(k2, 60_000);
    await Promise.all(Array.from({ length: 10 }, () => s.hit(k2, 60_000)));
    expect((await db.rateLimitBucket.findUniqueOrThrow({ where: { key: k2 } })).count).toBe(11);
  });
  it("prunes only expired counters", async () => {
    const s = new DbStore(); const live = `t:${Math.random()}`; const dead = `t:${Math.random()}`;
    await s.hit(live, 60_000); await s.hit(dead, 60_000); await db.rateLimitBucket.update({ where: { key: dead }, data: { resetAt: new Date(Date.now() - 1000) } });
    await pruneRateLimits();
    expect(await db.rateLimitBucket.findUnique({ where: { key: live } })).not.toBeNull();
    expect(await db.rateLimitBucket.findUnique({ where: { key: dead } })).toBeNull();
  });
});
