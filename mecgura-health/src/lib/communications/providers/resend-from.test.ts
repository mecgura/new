import { describe, expect, it } from "vitest";
import { fromAddress } from "./resend-email";

// Regression: EMAIL_FROM entered as "Name <addr>" produced `Name <Name <addr>>` and Resend rejected every email with 422.
describe("fromAddress", () => {
  it("keeps a bare address", () => expect(fromAddress("noreply@mecgura.tech")).toBe("noreply@mecgura.tech"));
  it("extracts the address from the display form", () => expect(fromAddress("MECGURA HEALTH <noreply@mecgura.tech>")).toBe("noreply@mecgura.tech"));
  it("trims whitespace and handles empty values", () => { expect(fromAddress("  noreply@mecgura.tech ")).toBe("noreply@mecgura.tech"); expect(fromAddress(undefined)).toBe(""); });
});
