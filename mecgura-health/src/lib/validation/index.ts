import { z } from "zod";
import { AppError, zodFieldErrors } from "@/lib/errors";

export * from "./fields";

/** Parse untrusted input or throw an AppError(VALIDATION_ERROR) carrying per-field messages. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError("VALIDATION_ERROR", { fieldErrors: zodFieldErrors(result.error) });
  return result.data;
}

/** Convert FormData into a plain object (single values only; files are skipped). */
export function formDataToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}
