import { ApiError, clientIp, handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { applySchema, applyToJob, MAX_RESUME_BYTES } from "@/services/hiring/ats";

type Ctx = { params: Promise<{ orgSlug: string; jobSlug: string }> };

/** Public job application from the careers page (multipart: name, phone, email, experience, resume). */
export const POST = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`careers:apply:${clientIp(req)}`, 8, 10 * 60_000);
  const { orgSlug, jobSlug } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_RESUME_BYTES + 50_000) throw new ApiError("VALIDATION_ERROR", "Resume can be up to 4 MB.");
  const form = await req.formData().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "Please fill in the form.");
  });
  const parsed = applySchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Please check the form.", { details: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])) });
  const file = form.get("resume");
  const r = await applyToJob(orgSlug, jobSlug, parsed.data, file instanceof File ? file : null);
  return ok({ applied: true, duplicate: r.duplicate }, { status: 201 });
});
