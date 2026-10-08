import { z } from "zod";
import { PHONE_PATTERN } from "./fields";

/** Normalises an email or Indian mobile number typed into the single "Email or phone" box. */
export function normalizeIdentifier(raw: string): { kind: "email" | "phone"; value: string } | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.includes("@")) return z.email().safeParse(v.toLowerCase()).success ? { kind: "email", value: v.toLowerCase() } : null;
  const digits = v.replace(/[\s()-]/g, "");
  const m = PHONE_PATTERN.exec(digits);
  return m ? { kind: "phone", value: `+91${m[1]}` } : null;
}

/** Login only checks presence/shape — never reveal password policy or which part was wrong. */
export const loginSchema = z.object({
  identifier: z
    .string({ error: "Enter your email or phone number." })
    .trim()
    .min(1, "Enter your email or phone number.")
    .max(254)
    .refine((v) => normalizeIdentifier(v) !== null, "Enter a valid email address or 10-digit mobile number."),
  password: z.string({ error: "Password is required." }).min(1, "Password is required.").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;
