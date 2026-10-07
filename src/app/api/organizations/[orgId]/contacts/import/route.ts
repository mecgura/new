import { ApiError, handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { importContactsCsv } from "@/services/inbox/contacts";

type Ctx = { params: Promise<{ orgId: string }> };

const MAX_BYTES = 2 * 1024 * 1024;

/** CSV import (multipart "file"). Columns: name, phone, email, tags (a;b), lead_status, lifecycle, source, opt_in. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "contacts:import");
  enforceRateLimit(`import:${access.user.id}`, 10, 60 * 60_000);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 10_000) throw new ApiError("VALIDATION_ERROR", "CSV files can be up to 2 MB.");
  const form = await req.formData().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "Upload the CSV as multipart/form-data.");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError("VALIDATION_ERROR", "Choose a CSV file.", { details: { file: ["Required"] } });
  if (file.size > MAX_BYTES) throw new ApiError("VALIDATION_ERROR", "CSV files can be up to 2 MB.");
  if (!/\.csv$/i.test(file.name) && !/csv|text\/plain|excel/.test(file.type)) throw new ApiError("VALIDATION_ERROR", "Upload a .csv file.");
  const result = await importContactsCsv({ organizationId: access.organizationId, actorUserId: access.user.id, req }, await file.text());
  return ok(result);
});
