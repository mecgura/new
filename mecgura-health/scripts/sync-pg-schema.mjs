// Generates prisma/schema.postgres.prisma from prisma/schema.prisma so the two
// never drift. Run: npm run db:sync-schema   (add --check in CI to verify).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf8");
const banner = "// GENERATED from prisma/schema.prisma by scripts/sync-pg-schema.mjs — do not edit.\n";
const out = banner + src.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
const target = "prisma/schema.postgres.prisma";

if (process.argv.includes("--check")) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== out) {
    console.error("schema.postgres.prisma is out of date. Run: npm run db:sync-schema");
    process.exit(1);
  }
  console.log("schema.postgres.prisma is in sync.");
} else {
  writeFileSync(target, out);
  console.log("Wrote", target);
}
