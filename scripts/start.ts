// `npm start`: one command that runs the app in production mode.
//
// Builds first only when there is no build yet or the code changed since the
// last one; otherwise it starts straight away. A failed build never falls back
// to serving the old one, and a busy port is reported before any build runs.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, ".next-build");
const BUILD_ID = path.join(DIST, "BUILD_ID");
const STAMP = path.join(DIST, ".built-from.json");
const NEXT_BIN = path.join(ROOT, "node_modules", ".bin", "next");
const PORT = Number(process.env.PORT) || 3000;

// What the build is made from. Runtime data (data/, evidence-store/), keys in
// .env.local (read when the server starts, not baked in) and scripts are not.
const BUILD_INPUTS = ["src", "public", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"];

// Next waits for every open connection to finish before it exits, and an open
// app tab polls often enough that its connections never go idle. Past this
// grace period the server is stopped rather than left refusing requests.
const FORCE_STOP_AFTER_MS = 5000;

let child: ChildProcess | null = null;
let stopping = false;
let stopRequestedAt = 0;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    const running = child;
    // One Ctrl+C can arrive several times within milliseconds (from the
    // terminal and relayed by npm/tsx); only a later press means "stop now".
    if (stopping && running && Date.now() - stopRequestedAt > 1000) {
      running.kill("SIGKILL");
      return;
    }
    if (stopping) return;
    stopping = true;
    stopRequestedAt = Date.now();
    if (!running) return;
    // Ctrl+C already reaches the child through the terminal; this covers a
    // signal sent to this process alone. Next ignores the duplicate.
    running.kill(signal);
    setTimeout(() => {
      if (child !== running) return;
      console.log("[start] An open browser tab kept the server from stopping. Stopping it now.");
      running.kill("SIGKILL");
    }, FORCE_STOP_AFTER_MS).unref();
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((resolve) => {
    const spawned = spawn(command, args, { stdio: "inherit", env });
    child = spawned;
    spawned.once("error", (error) => {
      console.error(`[start] Could not run ${command}: ${error.message}`);
      resolve(1);
    });
    spawned.once("exit", (code, signal) => {
      child = null;
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function newestInputChange(): number {
  let newest = 0;
  const visit = (target: string) => {
    if (path.basename(target) === ".DS_Store") return;
    let stats;
    try {
      stats = statSync(target);
    } catch {
      return;
    }
    if (stats.isDirectory()) for (const entry of readdirSync(target)) visit(path.join(target, entry));
    else newest = Math.max(newest, stats.mtimeMs);
  };
  for (const input of BUILD_INPUTS) visit(path.join(ROOT, input));
  return newest;
}

/** When the current build's inputs were read, or null when there is no complete build. */
function lastBuildTime(): number | null {
  if (!existsSync(BUILD_ID)) return null;
  const buildId = readFileSync(BUILD_ID, "utf8").trim();
  try {
    // Recorded before the build started, so an edit made mid-build still counts as a change.
    const stamp = JSON.parse(readFileSync(STAMP, "utf8")) as { buildId?: string; startedAt?: number };
    if (stamp.buildId === buildId && typeof stamp.startedAt === "number") return stamp.startedAt;
  } catch {
    // built with `npm run build` directly
  }
  return statSync(BUILD_ID).mtimeMs;
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRINUSE"));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port);
  });
}

async function main() {
  if (await portInUse(PORT)) {
    console.error(`[start] Port ${PORT} is already in use, most likely by another copy of the app. Stop it (Ctrl+C in its terminal), then run npm start again.`);
    process.exit(1);
  }

  const builtAt = lastBuildTime();
  if (builtAt === null || newestInputChange() > builtAt) {
    console.log(builtAt === null ? "[start] No production build yet. Building first (a minute or two)…" : "[start] The code changed since the last build. Rebuilding first (a minute or two)…");
    const startedAt = Date.now();
    const code = await run("npm", ["run", "build"]);
    if (stopping) process.exit(130);
    if (code !== 0) {
      console.error("[start] The build failed, so the app was not started. Fix the error above, then run npm start again.");
      process.exit(code);
    }
    writeFileSync(STAMP, JSON.stringify({ buildId: readFileSync(BUILD_ID, "utf8").trim(), startedAt }));
  } else {
    console.log("[start] The build is up to date.");
    // The build step normally applies database migrations; do it here too.
    const code = await run("npm", ["run", "db:init", "--silent"]);
    if (stopping) process.exit(130);
    if (code !== 0) process.exit(code);
  }

  const code = await run(NEXT_BIN, ["start", "-p", String(PORT)], { ...process.env, NEXT_DIST_DIR: ".next-build" });
  // Stopped on purpose (Ctrl+C) is a normal exit, not a failure.
  process.exit(stopping ? 0 : code);
}

void main();
