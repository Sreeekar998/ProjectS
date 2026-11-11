import { NextRequest, NextResponse } from "next/server";
import { getEventsSince, subscribeLive, type SunEvent } from "@/lib/events/bus";
import { isShuttingDown, trackOpenStream } from "@/lib/events/open-streams";

export const dynamic = "force-dynamic";

// Deliberately no `event:` field — every event arrives as a plain `message`
// so the client can filter on the JSON payload's own `type` in one place
// instead of registering a listener per event family.
function encodeEvent(event: SunEvent): string {
  return `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (isShuttingDown()) {
    // The server is stopping. Closing the connection, instead of keeping it for
    // the tab's next reconnect or poll, lets the server finish exiting.
    return new Response("The server is shutting down.", { status: 503, headers: { Connection: "close", "Retry-After": "5" } });
  }
  const url = new URL(req.url);
  // Browsers auto-reconnect EventSource with a `Last-Event-ID` header set to
  // the last `id:` line they saw — honor that first so a dropped connection
  // resumes without the client tracking sequence numbers itself.
  const lastEventIdHeader = req.headers.get("last-event-id");
  const since = Number(lastEventIdHeader ?? url.searchParams.get("since") ?? "0") || 0;
  const streamMode = url.searchParams.get("stream") !== "false";

  const buffered = await getEventsSince(projectId, since);

  if (!streamMode) {
    // Polling fallback: plain JSON, same resumability contract via `since`.
    return NextResponse.json({ events: buffered, nextSince: buffered.length > 0 ? buffered[buffered.length - 1]!.sequence : since });
  }

  const encoder = new TextEncoder();
  let close: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      for (const event of buffered) controller.enqueue(encoder.encode(encodeEvent(event)));

      const unsubscribe = subscribeLive(projectId, (event) => {
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          // controller already closed by client disconnect; close() handles cleanup
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      // Ends on client disconnect, or when the server shuts down: an open stream
      // would otherwise keep `next start` from exiting on Ctrl+C.
      let untrack = () => {};
      close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        untrack();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      untrack = trackOpenStream(close);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      close?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
