import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { queryFromSearchParams } from "@/lib/services/analytics-core";
import { clinicInsights, operationsScorecard } from "@/lib/services/analytics-command";
import { communicationAnalytics, billingAnalytics, pharmacyAnalytics } from "@/lib/services/analytics-business";
import { clinicalAnalytics, labAnalytics } from "@/lib/services/analytics-clinical";
import { appointmentAnalytics, doctorAnalytics, followUpAnalytics, opdAnalytics, patientAnalytics } from "@/lib/services/analytics-people";

export const dynamic = "force-dynamic";
type Fn = (ctx: TenantRequestContext, raw: unknown) => Promise<unknown>;
const DOMAINS: Record<string, Fn> = {
  patients: (c, r) => patientAnalytics(c, r), appointments: appointmentAnalytics, opd: opdAnalytics, followups: followUpAnalytics, doctors: doctorAnalytics,
  clinical: (c, r) => clinicalAnalytics(c, r), lab: (c, r) => labAnalytics(c, r), billing: (c, r) => billingAnalytics(c, r), pharmacy: pharmacyAnalytics, communication: communicationAnalytics,
  insights: clinicInsights, scorecard: operationsScorecard,
};
/** One analytics domain. The domain name is looked up in a fixed table: unknown names are a 404, nothing is ever interpolated into a query. */
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "analytics.view" }, async ({ ctx, req, params }) => {
  const fn = Object.hasOwn(DOMAINS, params.domain ?? "") ? DOMAINS[params.domain] : undefined;
  if (!fn) throw new AppError("NOT_FOUND", { message: "Unknown analytics section." });
  return fn(ctx, queryFromSearchParams(new URL(req.url).searchParams));
});
