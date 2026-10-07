import { ApiError, errorResponse } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { realtime, type RealtimeEvent } from "@/lib/realtime/broker";
import { can } from "@/services/inbox/conversations";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ orgId: string }> };

/**
 * Server-Sent Events stream for one organization. Events contain ids only;
 * agents only receive conversation events for chats they can see.
 */
export async function GET(req: Request, { params }: Ctx) {
  let access;
  try {
    ({ access } = await orgRoute(req, params, "inbox:read"));
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e);
    throw e;
  }
  const viewAll = can(access, "inbox:view_all");
  const me = access.user.id;
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send(`retry: 5000\nevent: ready\ndata: {}\n\n`);
      const unsubscribe = realtime().subscribe(access.organizationId, (event: RealtimeEvent) => {
        if (!viewAll && "assignedToUserId" in event && event.assignedToUserId && event.assignedToUserId !== me) return;
        send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
