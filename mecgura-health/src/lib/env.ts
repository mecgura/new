import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).optional(),
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  AUTH_SECRET: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  TENANT_ROOT_DOMAIN: z.string().optional(),
  DEV_TENANT_SLUG: z.string().optional(),
  SHOW_PLANNED_MODULES: bool,
  ENABLE_DESIGN_PREVIEW: bool,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", ""]).optional(),
});

export type Env = z.infer<typeof schema> & { isProd: boolean; isDev: boolean };

let cached: Env | undefined;

/** Validated, typed environment. Fails fast (at first use) on a misconfigured production server. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  const env = parsed.data;
  const isProd = env.NODE_ENV === "production";
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (isProd && !isBuild && (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)) {
    throw new Error("AUTH_SECRET must be set to a random value of at least 32 characters in production.");
  }
  cached = { ...env, isProd, isDev: env.NODE_ENV === "development" };
  return cached;
}
