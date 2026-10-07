import { ApiError, handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { submitTemplate, type ReviewSample } from "@/services/templates/templates";

type Ctx = { params: Promise<{ orgId: string; tid: string }> };

const SAMPLE_TYPES: Record<string, number> = {
  "image/jpeg": 5, "image/png": 5, "video/mp4": 16, "application/pdf": 100,
};

/** Submits a draft for Meta review. Media headers send a sample file as multipart ("sample"). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "templates:manage");
  enforceRateLimit(`tpl-submit:${access.organizationId}`, 30, 60 * 60_000);
  let sample: ReviewSample | undefined;
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    if (Number(req.headers.get("content-length") ?? 0) > 101 * 1024 * 1024) throw new ApiError("VALIDATION_ERROR", "The sample file is too large.");
    const form = await req.formData().catch(() => {
      throw new ApiError("VALIDATION_ERROR", "Send the sample as multipart/form-data.");
    });
    const file = form.get("sample");
    if (file instanceof File && file.size > 0) {
      const maxMb = SAMPLE_TYPES[file.type];
      if (!maxMb) throw new ApiError("VALIDATION_ERROR", "Samples must be JPG/PNG images, MP4 videos or PDF documents.", { details: { headerSample: ["Unsupported type"] } });
      if (file.size > maxMb * 1024 * 1024) throw new ApiError("VALIDATION_ERROR", `Sample too large (max ${maxMb} MB).`, { details: { headerSample: ["Too large"] } });
      sample = { file, filename: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200) || "sample", mimeType: file.type };
    }
  }
  return ok({ template: await submitTemplate(access, ids.tid, sample, req) });
});
