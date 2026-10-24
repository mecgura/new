import { clientIp, handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { documentResponse } from "@/lib/agreement-file";
import { clientDeleteDocument, clientDocumentFile } from "@/services/agreements/agreements";

type Ctx = { params: Promise<{ token: string; docId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`agreement:get:${clientIp(req)}`, 120, 60_000);
  const { token, docId } = await params;
  return documentResponse(await clientDocumentFile(token, docId));
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`agreement:write:${clientIp(req)}`, 30, 60_000);
  const { token, docId } = await params;
  return ok({ agreement: await clientDeleteDocument(token, docId, req) });
});
