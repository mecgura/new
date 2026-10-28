import { ApiError, handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { addCandidate, candidateSchema, MAX_RESUME_BYTES } from "@/services/hiring/ats";

type Ctx = { params: Promise<{ orgId: string }> };

/** Adds a candidate by hand: JSON, or multipart with a "resume" file. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ats:manage");
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    return ok({ candidate: await addCandidate(access, await readJson(req, candidateSchema), null, req) }, { status: 201 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_RESUME_BYTES + 50_000) throw new ApiError("VALIDATION_ERROR", "Resume can be up to 4 MB.");
  const form = await req.formData().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "Send the form as multipart/form-data.");
  });
  const parsed = candidateSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Please check the form.", { details: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])) });
  const file = form.get("resume");
  return ok({ candidate: await addCandidate(access, parsed.data, file instanceof File ? file : null, req) }, { status: 201 });
});
