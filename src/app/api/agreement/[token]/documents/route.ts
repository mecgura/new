import { clientIp, handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { readUpload } from "@/lib/agreement-file";
import { clientUploadDocument } from "@/services/agreements/agreements";

type Ctx = { params: Promise<{ token: string }> };

/** Business proof upload from the client's agreement page (PDF / JPG / PNG / WebP, up to 4 MB). */
export const POST = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`agreement:upload:${clientIp(req)}`, 20, 10 * 60_000);
  const token = (await params).token;
  const { kind, file } = await readUpload(req);
  return ok({ agreement: await clientUploadDocument(token, kind, file, req) }, { status: 201 });
});
