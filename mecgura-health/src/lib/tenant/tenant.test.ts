import { describe, expect, it } from "vitest";
import { scopeArgs } from "./scope";
import { parseTenantHost } from "./host";

describe("scopeArgs (tenant isolation)", () => {
  it("wraps read filters so tenantId can't be bypassed", () => {
    const a = scopeArgs("findMany", { where: { OR: [{ tenantId: "B" }, { name: "x" }] } }, "A");
    expect(a.where).toEqual({ AND: [{ OR: [{ tenantId: "B" }, { name: "x" }] }, { tenantId: "A" }] });
  });
  it("adds tenantId when no filter given", () => {
    expect(scopeArgs("count", undefined, "A").where).toEqual({ AND: [{}, { tenantId: "A" }] });
  });
  it("forces tenantId on unique lookups and soft-delete filter on reads", () => {
    expect(scopeArgs("findUnique", { where: { id: "1" } }, "A", { softDelete: true }).where).toEqual({ id: "1", tenantId: "A", deletedAt: null });
    expect(scopeArgs("update", { where: { id: "1" }, data: {} }, "A").where).toEqual({ id: "1", tenantId: "A" });
  });
  it("injects tenantId on create / createMany / upsert", () => {
    expect(scopeArgs("create", { data: { name: "n" } }, "A").data).toEqual({ name: "n", tenantId: "A" });
    expect(scopeArgs("createMany", { data: [{ n: 1 }, { n: 2 }] }, "A").data).toEqual([{ n: 1, tenantId: "A" }, { n: 2, tenantId: "A" }]);
    const u = scopeArgs("upsert", { where: { id: "1" }, create: {}, update: {} }, "A");
    expect(u.create).toEqual({ tenantId: "A" });
  });
  it("blocks writes targeting another tenant", () => {
    expect(() => scopeArgs("create", { data: { tenantId: "B" } }, "A")).toThrow();
    expect(() => scopeArgs("update", { where: { id: "1" }, data: { tenantId: "B" } }, "A")).toThrow();
    expect(() => scopeArgs("createMany", { data: [{ tenantId: "B" }] }, "A")).toThrow();
  });
  it("rejects missing tenant and unknown operations", () => {
    expect(() => scopeArgs("findMany", {}, "")).toThrow();
    expect(() => scopeArgs("somethingNew", {}, "A")).toThrow();
  });
});

describe("parseTenantHost", () => {
  it("resolves subdomains, custom domains and the platform host", () => {
    expect(parseTenantHost("clinic.health.example.com", "health.example.com")).toEqual({ kind: "subdomain", value: "clinic" });
    expect(parseTenantHost("drsharma.com", "health.example.com")).toEqual({ kind: "custom", value: "drsharma.com" });
    expect(parseTenantHost("health.example.com:3000", "health.example.com")).toBeNull();
    expect(parseTenantHost("localhost:3000")).toBeNull();
    expect(parseTenantHost("127.0.0.1:3000")).toBeNull();
  });
});
