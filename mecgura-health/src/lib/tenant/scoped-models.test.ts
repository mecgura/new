import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TENANT_ID_EXEMPT_MODELS, TENANT_SCOPED_MODELS } from "./scoped-models";

describe("tenant model registry", () => {
  it("every Prisma model with a tenantId column is registered or explicitly exempt", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
    const withTenant = models.filter(([, , body]) => /^\s+tenantId\s/m.test(body)).map(([, name]) => name);
    const missing = withTenant.filter((m) => !(m in TENANT_SCOPED_MODELS) && !(m in TENANT_ID_EXEMPT_MODELS));
    expect(missing, `Register in src/lib/tenant/scoped-models.ts: ${missing.join(", ")}`).toEqual([]);
  });
});
