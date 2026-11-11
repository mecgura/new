import { describe, expect, it } from "vitest";
import { serializeMetadata } from "./index";

describe("audit metadata", () => {
  it("redacts sensitive keys and caps size", () => {
    expect(JSON.parse(serializeMetadata({ patientId: "p1", diagnosis: "secret" })!)).toEqual({ patientId: "p1", diagnosis: "[REDACTED]" });
    expect(JSON.parse(serializeMetadata({ blob: "x".repeat(5000) })!)).toEqual({ truncated: true });
    expect(serializeMetadata(undefined)).toBeNull();
  });
});
