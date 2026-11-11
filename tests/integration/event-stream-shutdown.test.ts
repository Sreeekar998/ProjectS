import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/projects/[id]/events/route";
import { closeOpenStreams, shutDownStreams } from "@/lib/events/open-streams";

async function openStream(signal?: AbortSignal) {
  const request = new Request("http://localhost/api/projects/prj_stream_test/events", { signal }) as unknown as NextRequest;
  const response = await GET(request, { params: Promise.resolve({ id: "prj_stream_test" }) });
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain(": connected");
  return reader;
}

/** Reads to the end, failing if the stream is still open after two seconds. */
async function readsToEnd(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const timeout = new Promise<"still open">((resolve) => setTimeout(() => resolve("still open"), 2000));
  const drain = (async () => {
    while (!(await reader.read()).done) {
      // buffered heartbeat or events
    }
    return "ended" as const;
  })();
  return Promise.race([drain, timeout]);
}

describe("project event stream on shutdown", () => {
  it("ends every open stream, so the production server can exit on Ctrl+C", async () => {
    const first = await openStream();
    const second = await openStream();
    closeOpenStreams();
    expect(await readsToEnd(first)).toBe("ended");
    expect(await readsToEnd(second)).toBe("ended");
  });

  it("forgets a stream the browser already closed", async () => {
    const tab = new AbortController();
    const reader = await openStream(tab.signal);
    tab.abort();
    expect(await readsToEnd(reader)).toBe("ended");
    expect(() => closeOpenStreams()).not.toThrow();
  });

  // Last: shutting down is permanent for this module.
  it("refuses new streams once the server is stopping, so a reconnecting tab cannot hold it open", async () => {
    const open = await openStream();
    shutDownStreams();
    expect(await readsToEnd(open)).toBe("ended");
    const request = new Request("http://localhost/api/projects/prj_stream_test/events") as unknown as NextRequest;
    const reconnect = await GET(request, { params: Promise.resolve({ id: "prj_stream_test" }) });
    expect(reconnect.status).toBe(503);
    expect(reconnect.headers.get("connection")).toBe("close");
  });
});
