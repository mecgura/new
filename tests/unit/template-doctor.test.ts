import { describe, expect, it } from "vitest";
import { diagnoseRejection } from "@/lib/template-doctor";

const t = (body: string, category = "UTILITY") => ({ category, body, headerText: "", footer: "" });

describe("template doctor", () => {
  it("moves a promotion sent as utility to marketing and says why", () => {
    const d = diagnoseRejection("INCORRECT_CATEGORY", t("Diwali sale! Get 20% off on all cakes today only."));
    expect(d.title).toBe("Wrong category");
    expect(d.fixed.category).toBe("MARKETING");
    expect(d.changes.join(" ")).toContain("Marketing");
  });

  it("repairs the mechanical format problems only", () => {
    const d = diagnoseRejection("INVALID_FORMAT", t("{{1}}   your order is ready.\n\n\n\nCollect it by {{2}}{{3}}"));
    expect(d.fixed.body).toBe("Hello {{1}} your order is ready.\n\nCollect it by {{2}}, {{3}}.");
    expect(d.fixed.category).toBe("UTILITY");
    expect(d.changes).toHaveLength(4);
  });

  it("does not pretend to fix a policy rejection", () => {
    const d = diagnoseRejection("ABUSIVE_CONTENT", t("Your appointment is confirmed for tomorrow at 5 pm."));
    expect(d.title).toBe("Against Meta's policy");
    expect(d.changes).toHaveLength(0);
    expect(d.fixed.body).toBe("Your appointment is confirmed for tomorrow at 5 pm.");
  });

  it("still gives the usual causes when Meta gives no reason", () => {
    const d = diagnoseRejection("", t("Hello, your bill is due."));
    expect(d.title).toBe("Rejected without a reason");
    expect(d.steps.length).toBeGreaterThan(0);
  });
});
