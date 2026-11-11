// Live event streams that are still open, so they can be ended on shutdown.
//
// On Ctrl+C the production server (`next start`) stops accepting connections
// and then waits for every open request to finish before it exits. A project's
// event stream never finishes while a browser tab is open, and when it is ended
// the tab reconnects over a connection it already holds. Without this the
// server kept running but refused every new request.

type CloseStream = () => void;

interface StreamRegistry {
  streams: Set<CloseStream>;
  shuttingDown: boolean;
}

const REGISTRY_KEY = Symbol.for("sun.events.streamRegistry");

function registry(): StreamRegistry {
  const holder = globalThis as typeof globalThis & { [REGISTRY_KEY]?: StreamRegistry };
  if (!holder[REGISTRY_KEY]) {
    holder[REGISTRY_KEY] = { streams: new Set(), shuttingDown: false };
    // Only join a shutdown someone else already handles (Next registers its own
    // SIGINT/SIGTERM handlers before any route loads). Adding a listener to a
    // process with none would stop Ctrl+C from terminating it.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      if (process.listenerCount(signal) > 0) process.on(signal, shutDownStreams);
    }
  }
  return holder[REGISTRY_KEY];
}

/** Tracks an open stream; returns the function that stops tracking it. */
export function trackOpenStream(close: CloseStream): () => void {
  const { streams } = registry();
  streams.add(close);
  return () => streams.delete(close);
}

/** Ends every open event stream. */
export function closeOpenStreams(): void {
  for (const close of [...registry().streams]) close();
}

/** The server is stopping: end open streams and refuse new ones from now on. */
export function shutDownStreams(): void {
  registry().shuttingDown = true;
  closeOpenStreams();
}

export function isShuttingDown(): boolean {
  return registry().shuttingDown;
}

// Set up as soon as the events route loads, so a later stop signal is seen.
registry();
