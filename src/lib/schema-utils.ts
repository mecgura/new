import { z } from "zod";

/**
 * Like `.partial()`, but a missing key stays missing. Zod 4 still fills
 * `.default()` values inside `.partial()`, so a PATCH that sends one field
 * would silently reset every other defaulted field.
 */
export function partialNoDefaults<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const shape = Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, ((v instanceof z.ZodDefault ? v.unwrap() : v) as z.ZodType).optional()]));
  return z.object(shape) as unknown as ReturnType<z.ZodObject<S>["partial"]>;
}
