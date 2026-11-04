import { googleClicked, openFeedback } from "@/services/reviews/reviews";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string }> };

/** Public: counts the click, then opens the business's Google review page. */
export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;
  const f = await openFeedback(token.slice(0, 40));
  if (!f?.reviewUrl) return new Response("Review link not set.", { status: 404 });
  await googleClicked(token);
  return Response.redirect(f.reviewUrl, 302);
}
