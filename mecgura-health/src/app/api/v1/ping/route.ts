import { keyRoute } from "@/lib/api/key-route";
export const dynamic = "force-dynamic";
/** Confirms a key works and tells it what it may do. */
export const GET = keyRoute(null, async ({ principal }) => ({ scopes: principal.scopes, scope: principal.tenantId ? "clinic" : "platform" }));
