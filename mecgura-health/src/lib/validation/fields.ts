import { z } from "zod";

/**
 * Centralised field rules. Use these everywhere (client forms AND server handlers) so the
 * same input always produces the same human-readable message. The server is the authority:
 * never trust that the browser validated anything.
 */
export const requiredText = (label: string, opts: { min?: number; max?: number } = {}) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(opts.min ?? 1, opts.min && opts.min > 1 ? `${label} must be at least ${opts.min} characters.` : `${label} is required.`)
    .max(opts.max ?? 200, `${label} must be ${opts.max ?? 200} characters or fewer.`);

export const optionalText = (label: string, max = 500) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const email = z
  .string({ error: "Email is required." })
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .max(254, "Email is too long.")
  .pipe(z.email("Enter a valid email address."));

/** Indian mobile numbers: optional +91/0 prefix, 10 digits starting 6-9. Normalised to +91XXXXXXXXXX. */
export const PHONE_PATTERN = /^(?:\+?91[\s-]?|0)?([6-9]\d{9})$/;
export const phone = z
  .string({ error: "Phone number is required." })
  .trim()
  .min(1, "Phone number is required.")
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => PHONE_PATTERN.test(v), "Enter a valid 10-digit mobile number.")
  .transform((v) => `+91${PHONE_PATTERN.exec(v)![1]}`);

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(phone.optional());

/** Length over complexity (NIST 800-63B): 10+ characters, at least one letter and one number. */
export const password = z
  .string({ error: "Password is required." })
  .min(10, "Password must be at least 10 characters.")
  .max(128, "Password must be 128 characters or fewer.")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Password must include at least one letter and one number.");

export const numeric = (label: string, opts: { min?: number; max?: number; integer?: boolean } = {}) => {
  let schema = z.coerce.number({ error: `${label} must be a number.` });
  if (opts.integer) schema = schema.int(`${label} must be a whole number.`);
  if (opts.min !== undefined) schema = schema.min(opts.min, `${label} must be ${opts.min} or more.`);
  if (opts.max !== undefined) schema = schema.max(opts.max, `${label} must be ${opts.max} or less.`);
  return schema;
};

/** ISO calendar date (yyyy-mm-dd) as sent by <input type="date">. */
export const isoDate = (label: string, opts: { allowFuture?: boolean } = {}) =>
  z
    .string({ error: `${label} is required.` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Enter a valid ${label.toLowerCase()}.`)
    .refine((v) => {
      const d = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    }, `Enter a valid ${label.toLowerCase()}.`)
    .refine((v) => opts.allowFuture !== false || v <= new Date().toISOString().slice(0, 10), `${label} can't be in the future.`);

export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour in #RRGGBB format.")
  .transform((v) => v.toLowerCase());

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only.")
  .min(3, "Must be at least 3 characters.")
  .max(63, "Must be 63 characters or fewer.");
