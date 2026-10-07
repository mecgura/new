import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, safeEqual } from "@/lib/crypto";
import { normalizeEvents, verifySignature } from "@/providers/meta/webhook";
import { toE164 } from "@/providers/meta/api";
import { isDemoAvailable, isMetaConfigured, missingMetaConfig, publicMetaConfig } from "@/providers/meta/config";
import { demoIds } from "@/providers/meta/demo";
import { manualConnectSchema } from "@/lib/validations";

afterEach(() => vi.unstubAllEnvs());

describe("secret encryption (AES-256-GCM)", () => {
  it("round-trips and never stores plaintext", () => {
    const enc = encryptSecret("EAAB-super-secret-token");
    expect(enc).not.toContain("super-secret");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe("EAAB-super-secret-token");
  });
  it("uses a fresh IV every time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });
  it("detects tampering", () => {
    const [v, iv, tag, ct] = encryptSecret("value").split(":");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64url")].join(":"))).toThrow();
  });
  it("works with an explicit 32-byte key and rejects a wrong-size key", () => {
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(decryptSecret(encryptSecret("x"))).toBe("x");
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => encryptSecret("x")).toThrow();
  });
  it("refuses to run without a key in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", "");
    expect(() => encryptSecret("x")).toThrow(/not configured/);
  });
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("Meta webhook primitives", () => {
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
  const sig = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  it("verifies X-Hub-Signature-256 against any candidate secret", () => {
    expect(verifySignature(body, sig("s1"), ["other", "s1"])).toBe(true);
    expect(verifySignature(body, sig("s1"), ["s2"])).toBe(false);
    expect(verifySignature(body, null, ["s1"])).toBe(false);
    expect(verifySignature(body, "md5=abc", ["s1"])).toBe(false);
    expect(verifySignature(body, sig("s1"), ["", ""])).toBe(false);
  });
  it("normalizes messages, statuses, quality and unknown fields", () => {
    const events = normalizeEvents({
      entry: [
        {
          id: "111",
          changes: [
            { field: "messages", value: { metadata: { phone_number_id: "222" }, messages: [{ id: "wamid.1", from: "919", type: "text", timestamp: "1" }], statuses: [{ id: "wamid.2", status: "sent", recipient_id: "918" }] } },
            { field: "phone_number_quality_update", value: { display_phone_number: "+91 98765 43210", event: "FLAGGED", current_limit: "TIER_1K" } },
            { field: "business_capability_update", value: {} },
          ],
        },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(["message", "status", "quality", "other"]);
    expect(events[0]).toMatchObject({ wabaId: "111", phoneNumberId: "222", id: "wamid.1" });
  });
  it("toE164", () => {
    expect(toE164("+91 98765 43210")).toBe("+919876543210");
    expect(toE164("1 (202) 555-0100")).toBe("+12025550100");
  });
});

describe("Meta configuration", () => {
  it("is unconfigured by default, lists missing variable names, and enables demo", () => {
    expect(isMetaConfigured()).toBe(false);
    expect(missingMetaConfig()).toEqual(expect.arrayContaining(["META_APP_ID", "META_APP_SECRET", "META_EMBEDDED_SIGNUP_CONFIG_ID"]));
    expect(isDemoAvailable()).toBe(true);
  });
  it("demo can be forced off", () => {
    vi.stubEnv("WHATSAPP_DEMO_MODE", "off");
    expect(isDemoAvailable()).toBe(false);
  });
  it("public config never contains the app secret or verify token", () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "topsecretvalue");
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-me");
    expect(JSON.stringify(publicMetaConfig())).not.toMatch(/topsecretvalue|verify-me/);
  });
  it("demo ids are clearly fictional", () => {
    const ids = demoIds();
    expect(ids.wabaId.startsWith("DEMO-")).toBe(true);
    expect(ids.e164).toMatch(/^\+1202555\d{4}$/);
  });
});

describe("developer-setup validation", () => {
  const ok = { wabaId: "102290129340398", phoneNumberId: "106540352242922", accessToken: "E".repeat(120) };
  it("accepts valid input", () => expect(manualConnectSchema.safeParse(ok).success).toBe(true));
  it.each([
    [{ wabaId: "abc" }, "wabaId"],
    [{ phoneNumberId: "+919876543210" }, "phoneNumberId"],
    [{ accessToken: "short" }, "accessToken"],
    [{ accessToken: "x".repeat(60) + " <script>" }, "accessToken"],
    [{ appSecret: "not-hex" }, "appSecret"],
  ])("rejects %j", (patch, field) => {
    const r = manualConnectSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues.map((i) => i.path))).toContain(field);
  });
});
