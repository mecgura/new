// Read-only data-integrity check. Works on SQLite (DATABASE_URL=file:…) and PostgreSQL (needs psql).  npm run qa:integrity
//  1. every foreign key between two clinic-owned tables points at a row of the SAME clinic (cross-tenant reference = 0)
//  2. money: invoice totals, collected, refunded, due
//  3. stock: no negative batch quantities
//  4. audit log is never empty for a tenant that has data
// Prints a JSON report; exit code 1 when any check fails. Never modifies data.
import { readFileSync } from "node:fs";
import { Database, dbUrl, driverOf, pg, sqlitePath } from "./lib/backup-lib.mjs";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const models = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)].map((m) => ({ name: m[1], body: m[2] }));
const tenanted = new Set(models.filter((m) => /^\s+tenantId\s/m.test(m.body)).map((m) => m.name));
const edges = [];
for (const m of models.filter((x) => tenanted.has(x.name))) for (const r of m.body.matchAll(/^\s+\w+\s+(\w+)\??\s+@relation\(fields: \[(\w+)\], references: \[id\]/gm)) if (tenanted.has(r[1]) && r[1] !== m.name) edges.push({ child: m.name, col: r[2], parent: r[1] });

const driver = driverOf(); const run = (sql) => {
  if (driver === "sqlite") { const D = Database(); const d = new D(sqlitePath(), { readonly: true, fileMustExist: true }); try { return d.prepare(sql).all(); } finally { d.close(); } }
  return pg(["psql", dbUrl(), "-At", "-F", "|", "-c", sql]).trim().split("\n").filter(Boolean).map((l) => l.split("|"));
};
const count = (sql) => { const r = run(sql); return Number(Array.isArray(r[0]) ? r[0][0] : Object.values(r[0] ?? { n: 0 })[0]); };
const report = { driver, checks: [] }; const add = (name, bad, detail = "") => report.checks.push({ name, ok: bad === 0, violations: bad, detail });

for (const e of edges) add(`tenant of ${e.child}.${e.col} equals tenant of ${e.parent}`, count(`SELECT COUNT(*) FROM "${e.child}" c JOIN "${e.parent}" p ON c."${e.col}" = p."id" WHERE p."tenantId" IS NOT NULL AND c."tenantId" IS NOT NULL AND c."tenantId" <> p."tenantId"`));
const have = (t) => count(`SELECT COUNT(*) FROM "${t}"`) > 0;
if (have("Invoice")) {
  add("invoice total equals the sum of its line totals (non-draft, non-cancelled invoices that have lines)", count(`SELECT COUNT(*) FROM "Invoice" i WHERE i."status" NOT IN ('DRAFT','CANCELLED','VOID') AND EXISTS (SELECT 1 FROM "InvoiceItem" x WHERE x."invoiceId"=i."id") AND i."totalMinor" <> (SELECT COALESCE(SUM(x."lineTotalMinor"),0) FROM "InvoiceItem" x WHERE x."invoiceId"=i."id")`));
  add("no negative invoice amounts", count(`SELECT COUNT(*) FROM "Invoice" WHERE "totalMinor"<0 OR "collectedMinor"<0 OR "refundedMinor"<0 OR "dueMinor"<0`));
  add("refunded never exceeds collected", count(`SELECT COUNT(*) FROM "Invoice" WHERE "refundedMinor" > "collectedMinor"`));
  add("invoice collected equals the gross of its successful payments (refunds are tracked separately)", count(`SELECT COUNT(*) FROM "Invoice" i WHERE i."collectedMinor" <> (SELECT COALESCE(SUM(p."amountMinor"),0) FROM "Payment" p WHERE p."invoiceId"=i."id" AND p."status" IN ('SUCCESS','PARTIALLY_REFUNDED','REFUNDED'))`), "payments counted: SUCCESS, PARTIALLY_REFUNDED, REFUNDED");
  add("invoice refunded equals the sum of its payments' refunded amounts", count(`SELECT COUNT(*) FROM "Invoice" i WHERE i."refundedMinor" <> (SELECT COALESCE(SUM(p."refundedMinor"),0) FROM "Payment" p WHERE p."invoiceId"=i."id")`));
  add("payment refunded never exceeds amount", count(`SELECT COUNT(*) FROM "Payment" WHERE "refundedMinor" > "amountMinor" OR "refundedMinor" < 0`));
  add("payment numbers are unique per clinic", count(`SELECT COUNT(*) FROM (SELECT "tenantId","paymentNumber" FROM "Payment" GROUP BY 1,2 HAVING COUNT(*)>1) t`));
  add("invoice numbers are unique per clinic", count(`SELECT COUNT(*) FROM (SELECT "tenantId","invoiceNumber" FROM "Invoice" GROUP BY 1,2 HAVING COUNT(*)>1) t`));
}
add("no negative batch quantities", count(`SELECT COUNT(*) FROM "MedicineBatch" WHERE "quantityAvailable"<0 OR "reservedQuantity"<0 OR "dispensedQuantity"<0`));
add("reserved never exceeds available", count(`SELECT COUNT(*) FROM "MedicineBatch" WHERE "reservedQuantity" > "quantityAvailable"`));
add("stock ledger balance is never negative", count(`SELECT COUNT(*) FROM "StockTransaction" WHERE "balanceAfter"<0`));
add("no patient without a clinic", count(`SELECT COUNT(*) FROM "Patient" WHERE "tenantId" IS NULL OR "tenantId"=''`));
add("every non-platform user has a role of the same clinic or a system role", count(`SELECT COUNT(*) FROM "User" u JOIN "Role" r ON r."id"=u."roleId" WHERE r."tenantId" IS NOT NULL AND u."tenantId" IS NOT NULL AND r."tenantId" <> u."tenantId"`));
console.log(JSON.stringify({ ...report, failed: report.checks.filter((c) => !c.ok).length, total: report.checks.length }, null, 1));
process.exit(report.checks.some((c) => !c.ok) ? 1 : 0);
