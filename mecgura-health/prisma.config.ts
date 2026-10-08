import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Development: prisma/schema.prisma (SQLite).
  // Staging/production: PRISMA_SCHEMA=prisma/schema.postgres.prisma (PostgreSQL).
  // schema.postgres.prisma is generated: `npm run db:sync-schema`.
  schema: process.env.PRISMA_SCHEMA ?? "prisma/schema.prisma",
  migrations: {
    path: process.env.PRISMA_SCHEMA?.includes("postgres") ? "prisma/migrations-postgres" : "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Fallback keeps `prisma generate` working before DATABASE_URL is set (CI/first build).
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
