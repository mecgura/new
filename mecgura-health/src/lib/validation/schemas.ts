import { z } from "zod";
import { email } from "./fields";

/** Login only checks presence/shape — never reveal password policy or which part was wrong. */
export const loginSchema = z.object({
  email,
  password: z.string({ error: "Password is required." }).min(1, "Password is required.").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;
