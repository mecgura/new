import { handle } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { documentResponse } from "@/lib/agreement-file";
import { candidateResume } from "@/services/hiring/ats";

type Ctx = { params: Promise<{ orgId: string; candidateId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ats:manage");
  const r = await candidateResume(access, ids.candidateId);
  return documentResponse({ data: r.resume!, mimeType: r.resumeType || "application/octet-stream", fileName: r.resumeName || "resume" }, !["application/pdf", "image/jpeg", "image/png"].includes(r.resumeType));
});
