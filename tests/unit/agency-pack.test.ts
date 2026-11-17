import { describe, expect, it } from "vitest";
import { DEFAULT_AUTH_OPTIONS, validateTemplate, variableCount } from "@/lib/templates";
import { checkTemplate } from "@/lib/template-check";
import { packById } from "@/config/industry-packs";

describe("MECGURA agency pack", () => {
  const pack = packById("agency")!;

  it("every template passes Meta's format rules and has a sample for each variable", () => {
    expect(pack.templates.length).toBeGreaterThanOrEqual(12);
    for (const t of pack.templates) {
      const def = { name: t.name, language: "en", category: t.category, headerType: "none" as const, headerText: "", body: t.body, footer: t.footer, buttons: [], examples: t.examples, authOptions: DEFAULT_AUTH_OPTIONS };
      const { errors } = validateTemplate(def, { forSubmit: true });
      expect(errors, t.name).toEqual({});
      expect(t.examples.body?.length ?? 0, t.name).toBe(variableCount(t.body));
    }
  });

  it("utility templates are written as updates, marketing ones carry an opt-out line", () => {
    for (const t of pack.templates) {
      const v = checkTemplate(t.body);
      if (t.category === "UTILITY") expect(v.category, t.name).not.toBe("MARKETING");
      else expect(t.footer, t.name).toMatch(/STOP/);
    }
  });
});
