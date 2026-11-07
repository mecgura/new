import { describe, expect, it } from "vitest";
import { monthlyCost, waDigits, waLink } from "@/lib/wa-link";
import { DEFAULT_META_RATES } from "@/services/meta-rates";

describe("WhatsApp link tool", () => {
  it("normalises Indian and international numbers", () => {
    expect(waDigits("98765 43210")).toBe("919876543210");
    expect(waDigits("+91 98765-43210")).toBe("919876543210");
    expect(waDigits("09876543210")).toBe("919876543210");
    expect(waDigits("+1 (415) 555-2671")).toBe("14155552671");
    expect(waDigits("12345")).toBeNull();
    expect(waDigits("")).toBeNull();
    expect(waDigits("abc")).toBeNull();
  });
  it("builds a wa.me link and encodes the message", () => {
    expect(waLink("919876543210")).toBe("https://wa.me/919876543210");
    expect(waLink("919876543210", "Hi, price list? 100% & more")).toBe("https://wa.me/919876543210?text=Hi%2C%20price%20list%3F%20100%25%20%26%20more");
    expect(waLink("919876543210", "   ")).toBe("https://wa.me/919876543210");
  });
});

describe("message cost calculator", () => {
  const r = DEFAULT_META_RATES; // paise: marketing 78.46, utility 11.5, authentication 11.5
  it("charges each category at its rate", () => {
    const c = monthlyCost(r, { marketing: 1000, utility: 500, utilityFree: 0, authentication: 100 });
    expect(c.marketing).toBeCloseTo(784.6, 2);
    expect(c.utility).toBeCloseTo(57.5, 2);
    expect(c.authentication).toBeCloseTo(11.5, 2);
    expect(c.total).toBeCloseTo(853.6, 2);
    expect(c.perMessage).toBeCloseTo(853.6 / 1600, 4);
  });
  it("utility messages inside the 24-hour window are free, never more than the utility total", () => {
    expect(monthlyCost(r, { marketing: 0, utility: 500, utilityFree: 300, authentication: 0 }).utility).toBeCloseTo(23, 2);
    expect(monthlyCost(r, { marketing: 0, utility: 100, utilityFree: 900, authentication: 0 })).toMatchObject({ utility: 0, utilityPaid: 0, total: 0 });
    expect(monthlyCost(r, { marketing: 0, utility: 0, utilityFree: 0, authentication: 0 }).perMessage).toBe(0);
  });
});
