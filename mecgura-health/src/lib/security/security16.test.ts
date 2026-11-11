import { describe, expect, it } from "vitest";
import { decryptString, encryptString, hmacHex, keyring } from "./crypto";
import { classify, needsExtraScrutiny } from "./classification";
import { assertScanned, registerScanner, scannerStatus } from "./malware";
import { signAccess, verifyAccess } from "./signed-url";
import { base32Decode, base32Encode, hotp, otpauthUri, stepOf, verifyTotp } from "./totp";

describe("TOTP (RFC 4226 / 6238)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC 4226 HOTP test vectors", () => { ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"].forEach((v, i) => expect(hotp(secret, i)).toBe(v)); });
  it("matches RFC 6238 time vectors (SHA-1, 6 digits)", () => { expect(hotp(secret, stepOf(59_000))).toBe("287082"); expect(hotp(secret, stepOf(1_111_111_109_000))).toBe("081804"); expect(hotp(secret, stepOf(1_234_567_890_000))).toBe("005924"); });
  it("accepts ±1 step of drift, rejects older codes, wrong formats, and each step only once", () => {
    const now = 1_700_000_000_000; const cur = hotp(secret, stepOf(now));
    expect(verifyTotp(secret, cur, now)).toBe(stepOf(now)); expect(verifyTotp(secret, hotp(secret, stepOf(now) - 1), now)).toBe(stepOf(now) - 1); expect(verifyTotp(secret, hotp(secret, stepOf(now) - 3), now)).toBeNull();
    expect(verifyTotp(secret, cur, now, stepOf(now))).toBeNull(); // replay of an already-used step
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5"]) expect(verifyTotp(secret, bad, now)).toBeNull();
  });
  it("base32 round-trips and the otpauth URI is well formed", () => { const b = Buffer.from([1, 2, 3, 250, 251, 252, 0]); expect(base32Decode(base32Encode(b)).equals(b)).toBe(true); expect(otpauthUri("ABC", "a@b.c", "MECGURA HEALTH")).toMatch(/^otpauth:\/\/totp\/MECGURA%20HEALTH:a%40b\.c\?secret=ABC&issuer=/); });
});
describe("key management", () => {
  it("encrypts with AES-256-GCM, detects tampering, and isolates purposes", () => {
    const e = encryptString("top secret", "mfa-secret"); expect(e.blob).not.toContain("top secret"); expect(decryptString(e.blob, "mfa-secret", e.keyId)).toBe("top secret");
    expect(() => decryptString(e.blob, "audit", e.keyId)).toThrow(); const bad = e.blob.slice(0, -2) + (e.blob.endsWith("AA") ? "BB" : "AA"); expect(() => decryptString(bad, "mfa-secret", e.keyId)).toThrow();
    expect(encryptString("x", "mfa-secret").blob).not.toBe(encryptString("x", "mfa-secret").blob); // fresh IV every time
  });
  it("signatures are purpose-bound and key ids allow rotation", () => {
    const a = hmacHex("audit", "data"); expect(hmacHex("audit", "data", a.keyId).hmac).toBe(a.hmac); expect(hmacHex("apikey", "data").hmac).not.toBe(a.hmac);
    const old = process.env.SECURITY_KEYS;
    try {
      process.env.SECURITY_KEYS = `k1:${Buffer.alloc(32, 1).toString("base64")}`; const e1 = encryptString("v", "mfa-secret"); expect(e1.keyId).toBe("k1");
      process.env.SECURITY_KEYS = `k2:${Buffer.alloc(32, 2).toString("base64")},k1:${Buffer.alloc(32, 1).toString("base64")}`; expect(keyring()[0].id).toBe("k2"); expect(decryptString(e1.blob, "mfa-secret", "k1")).toBe("v"); expect(encryptString("v", "mfa-secret").keyId).toBe("k2");
      process.env.SECURITY_KEYS = `k2:${Buffer.alloc(32, 2).toString("base64")}`; expect(() => decryptString(e1.blob, "mfa-secret", "k1")).toThrow(); // retired key really is gone
    } finally { if (old === undefined) delete process.env.SECURITY_KEYS; else process.env.SECURITY_KEYS = old; }
  });
});
describe("signed access tokens", () => {
  const c = { resource: "/docs/report/123", tenantId: "t1", subject: "u1" };
  it("binds resource, tenant and subject, and expires", () => {
    const now = 1_700_000_000_000; const t = signAccess("s3cret-s3cret", { ...c, ttlSeconds: 60, now });
    expect(verifyAccess("s3cret-s3cret", t, { ...c, now: now + 30_000 })).toBe(true); expect(verifyAccess("s3cret-s3cret", t, { ...c, now: now + 61_000 })).toBe(false);
    for (const wrong of [{ resource: "/docs/report/124" }, { tenantId: "t2" }, { subject: "u2" }]) expect(verifyAccess("s3cret-s3cret", t, { ...c, ...wrong, now })).toBe(false);
    expect(verifyAccess("other-secret-0000", t, { ...c, now })).toBe(false); expect(verifyAccess("s3cret-s3cret", t + "x", { ...c, now })).toBe(false); expect(verifyAccess("s3cret-s3cret", "garbage", { ...c, now })).toBe(false);
    expect(() => signAccess("s", { ...c, ttlSeconds: 99999 })).toThrow();
  });
});
describe("classification and scanning hooks", () => {
  it("healthcare data is highly sensitive; unknown data defaults to confidential", () => { expect(classify("patient")).toBe("HIGHLY_SENSITIVE"); expect(classify("lab_report")).toBe("HIGHLY_SENSITIVE"); expect(classify("website")).toBe("PUBLIC"); expect(classify("something-new")).toBe("CONFIDENTIAL"); expect(needsExtraScrutiny("SENSITIVE")).toBe(true); expect(needsExtraScrutiny("PUBLIC")).toBe(false); });
  it("a registered scanner fails closed; none registered is reported as not configured", async () => {
    expect(scannerStatus().configured).toBe(false); await expect(assertScanned(new Uint8Array([1]), "a.png")).resolves.toBeUndefined();
    registerScanner({ name: "t", scan: async (b) => (b[0] === 1 ? { status: "INFECTED", signature: "X" } : b[0] === 2 ? { status: "ERROR", message: "down" } : { status: "CLEAN" }) });
    try { expect(scannerStatus()).toEqual({ configured: true, name: "t" }); await expect(assertScanned(new Uint8Array([1]), "a")).rejects.toThrow(/rejected/); await expect(assertScanned(new Uint8Array([2]), "a")).rejects.toThrow(/not accepted/); await expect(assertScanned(new Uint8Array([3]), "a")).resolves.toBeUndefined(); } finally { registerScanner(null); }
  });
});
