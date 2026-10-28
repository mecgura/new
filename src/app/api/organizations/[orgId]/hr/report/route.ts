import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { monthReport } from "@/services/hr/hrms";

type Ctx = { params: Promise<{ orgId: string }> };
const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), format: z.enum(["json", "csv"]).optional().default("json") });

/** Monthly attendance summary; ?format=csv downloads it for payroll. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "hr:manage");
  const { month, format } = readQuery(req, q);
  const r = await monthReport(access, month);
  if (format === "csv") return new Response(`﻿${r.csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${month}.csv"`, "Cache-Control": "no-store" } });
  return ok({ month: r.month, rows: r.rows });
});
