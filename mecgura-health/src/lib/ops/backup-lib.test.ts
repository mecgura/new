import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { packEncrypted, unpack, sha256File } from "../../../scripts/lib/backup-lib.mjs";

describe("backup encryption", () => {
  it("round-trips, detects a wrong key and a tampered file, and hides plaintext", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bk-")); const src = path.join(dir, "a.db"); writeFileSync(src, "PATIENT-ROW Ravi Kumar ".repeat(500));
    const k = randomBytes(32); const enc = path.join(dir, "a.enc"); await packEncrypted(src, enc, k);
    expect(readFileSync(enc).toString("latin1")).not.toContain("Ravi Kumar");
    const out = path.join(dir, "out.db"); await unpack(enc, out, k, true); expect(readFileSync(out, "utf8")).toBe(readFileSync(src, "utf8"));
    await expect(unpack(enc, path.join(dir, "bad.db"), randomBytes(32), true)).rejects.toThrow();
    const buf = readFileSync(enc); buf[40] ^= 0xff; const t = path.join(dir, "t.enc"); writeFileSync(t, buf); await expect(unpack(t, path.join(dir, "t.db"), k, true)).rejects.toThrow();
    expect(await sha256File(enc)).toMatch(/^[a-f0-9]{64}$/);
  });
});
