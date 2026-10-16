import { describe, expect, it } from "vitest";
import { createWorkspaceToken, verifyWorkspaceToken } from "@/lib/auth/workspace-cookie";
import { sniffImage, validateImage } from "./images";
import { brandContrastIssues, contrastRatio } from "@/theme/contrast";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("workspace cookie (Super Admin tenant view)", () => {
  const secret = "s".repeat(40);
  it("verifies only for the user it was issued to", () => {
    const t = createWorkspaceToken(secret, "user-1", "tenant-A");
    expect(verifyWorkspaceToken(secret, "user-1", t)).toBe("tenant-A");
    expect(verifyWorkspaceToken(secret, "user-2", t)).toBeNull();
  });
  it("rejects tampering and wrong secrets", () => {
    const t = createWorkspaceToken(secret, "user-1", "tenant-A");
    expect(verifyWorkspaceToken(secret, "user-1", t.replace("tenant-A", "tenant-B"))).toBeNull();
    expect(verifyWorkspaceToken("x".repeat(40), "user-1", t)).toBeNull();
    expect(verifyWorkspaceToken(secret, "user-1", "garbage")).toBeNull();
    expect(verifyWorkspaceToken(secret, "user-1", undefined)).toBeNull();
  });
});

describe("image validation", () => {
  it("decides by magic bytes, not by name or claimed type", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)></svg>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
  });
  it("enforces size limits and favicon-only ico", () => {
    expect(validateImage("LOGO", PNG).ok).toBe(true);
    expect(validateImage("LOGO", new Uint8Array(600 * 1024)).ok).toBe(false);
    expect(validateImage("LOGO", new Uint8Array(0)).ok).toBe(false);
    expect(validateImage("LOGO", new Uint8Array([0, 0, 1, 0, 1, 0])).ok).toBe(false);
    expect(validateImage("FAVICON", new Uint8Array([0, 0, 1, 0, 1, 0])).ok).toBe(true);
  });
});

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
  it("default brand passes", () => {
    expect(brandContrastIssues({ primary: "#14529e", secondary: "#0e7c86", accent: "#12a06a" })).toEqual({});
  });
});
