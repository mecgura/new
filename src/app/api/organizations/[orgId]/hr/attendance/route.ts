import { z } from "zod";
import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { dayAttendance, markAttendance, markSchema, todayIST } from "@/services/hr/hrms";

type Ctx = { params: Promise<{ orgId: string }> };
const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** One day's attendance register (defaults to today in India). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "hr:manage");
  const date = readQuery(req, q).date ?? todayIST();
  return ok({ date, today: todayIST(), rows: await dayAttendance(access, date) });
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "hr:manage");
  const input = await readJson(req, markSchema);
  return ok({ date: input.date, today: todayIST(), rows: await markAttendance(access, input, req) });
});
