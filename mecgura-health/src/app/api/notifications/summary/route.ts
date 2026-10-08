import { apiRoute } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const GET = apiRoute({}, async ({ ctx }) => N.todaySummary(ctx));
