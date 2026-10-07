import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // Local dev uses prisma/schema.prisma (SQLite).
  // Production/Vercel sets PRISMA_SCHEMA=prisma/schema.postgres.prisma (PostgreSQL).
  schema: process.env.PRISMA_SCHEMA ?? "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
