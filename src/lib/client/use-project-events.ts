"use client";
import { useEffect, useRef, useState } from "react";

export interface SunEventPayload {
  id: string;
  projectId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

/** Subscribes to a project's SSE event stream with automatic polling
 * fallback if EventSource fails to connect (e.g. a proxy stripping
 * text/event-stream). Returns the full ordered event log plus the most
 * recent event, so screens can either scan history or react incrementally.
 *
 * `hydrated` turns true once the first poll has answered (success or error).
 * Stage pages gate on it: before it, an empty log means "not loaded yet", not
 * "nothing happened", which is what made a finished Understand page flash the
 * progress rail on every open. */
export function useProjectEvents(projectId: string | undefined) {
  const [events, setEvents] = useState<SunEventPayload[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setHydrated(false);
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let source: EventSource | undefined;

    function appendEvent(evt: SunEventPayload) {
      if (evt.sequence <= lastSeqRef.current) return;
      lastSeqRef.current = evt.sequence;
      setEvents((prev) => [...prev, evt]);
    }

    // Polling runs continuously alongside the live stream, not only after
    // SSE reports an error — it's a self-healing redundant channel, not a
    // last-resort fallback. This absorbs any SSE-side inconsistency (a
    // dropped message, a race between two connections during React Strict
    // Mode's dev-only double-invoked effect, a proxy buffering the stream)
    // within one poll interval, and appendEvent's sequence-based dedupe
    // makes merging the two sources trivially safe.
    function openStream() {
      try {
        source = new EventSource(`/api/projects/${projectId}/events?since=${lastSeqRef.current}`);
        source.onmessage = (msg) => {
          try {
            appendEvent(JSON.parse(msg.data));
          } catch {
            // heartbeat/comment lines have no data payload
          }
        };
        source.onerror = () => {
          source?.close();
          source = undefined;
          // Reconnect from wherever we've actually gotten to — the polling
          // loop below keeps making progress in the meantime regardless.
          if (!cancelled) {
            setTimeout(() => {
              if (cancelled) return;
              source = new EventSource(`/api/projects/${projectId}/events?since=${lastSeqRef.current}`);
              source.onmessage = (msg) => {
                try {
                  appendEvent(JSON.parse(msg.data));
                } catch {
                  // heartbeat/comment lines have no data payload
                }
              };
            }, 2000);
          }
        };
      } catch {
        // no EventSource support; the polling loop still covers us
      }
    }

    let streamOpened = false;
    async function pollLoop() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/projects/${projectId}/events?since=${lastSeqRef.current}&stream=false`);
        const body = await res.json();
        for (const evt of body.events ?? []) appendEvent(evt);
      } catch {
        // network hiccup; keep polling
      }
      if (cancelled) return;
      // Set on error too: a failed first poll must never hold a page on its
      // loading state forever.
      setHydrated(true);
      // The live stream opens after the first poll, from where that poll got
      // to. Opening both at since=0 made every stage page download and parse
      // the whole history twice on open (Prompts and Measure logs run to
      // thousands of events).
      if (!streamOpened) {
        streamOpened = true;
        openStream();
      }
      pollTimer = setTimeout(pollLoop, 2500);
    }
    // The first poll runs at once (it replays the whole history from since=0);
    // later polls keep the 2.5 s cadence.
    pollTimer = setTimeout(pollLoop, 0);

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [projectId]);

  return { events, latest: events[events.length - 1], hydrated };
}
