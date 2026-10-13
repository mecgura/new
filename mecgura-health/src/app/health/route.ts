export const dynamic = "force-dynamic";
/** Liveness: the process is up and can answer. Deliberately does not touch the database (a DB outage must not make the platform restart-loop the app). */
export function GET() { return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } }); }
