import { versionInfo } from "@/lib/ops/readiness";

export const dynamic = "force-dynamic";
export function GET() { return Response.json(versionInfo(), { headers: { "Cache-Control": "no-store" } }); }
