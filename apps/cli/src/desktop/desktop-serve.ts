// The server the desktop shell runs, and how it tells the shell where it is. The shell reads one
// line marked `inteligir-desktop:` from stdout; everything else this process prints is the server's
// own, which the shell appends to the server log.
//
// A server already listening for this data dir at this version is adopted: its origin and a fresh
// handoff are announced, and this process leaves it running and exits. One that holds the data dir
// but cannot be adopted, or cannot sign a window in, is refused in the person's words. Otherwise the server boots here, and the
// line says where it listens, the one-time link that signs the window in, and how long a stop may
// take before the shell kills it, which is the server's own budget and never spelled in the shell.

import { readCliVersion } from "../paths";
import { DEBUG_NAMESPACES } from "../server/debug-log";
import type { RunServeOptions } from "../server/serve";
import { SHUTDOWN_TIMEOUT_MS } from "../server/shutdown";
import { adoptServer, planServerStart, resolveServerTarget, verifyServer } from "./server-start";
import type { ResolveServerTargetArgs } from "./server-start";

// the shell reads this prefix (apps/desktop/src-tauri/src/server.rs), held to it by
// tools/repo-guards/src/desktop-shell-wire.test.ts
const READY_MARKER = "inteligir-desktop:";

// past the server's own teardown budget, so the kill never lands mid-flush
const STOP_GRACE_HEADROOM_MS = 5000;

type Announcement =
  | { kind: "ready"; origin: string; handoffUrl: string; stopGraceMs: number }
  | { kind: "adopted"; origin: string; handoffUrl: string }
  | { kind: "refused"; reason: string };

const announcementLine = (announcement: Announcement): string =>
  `${READY_MARKER}${JSON.stringify(announcement)}\n`;

const announce = async (announcement: Announcement): Promise<void> => {
  const written: PromiseWithResolvers<void> = Promise.withResolvers();
  process.stdout.write(announcementLine(announcement), () => {
    written.resolve();
  });
  await written.promise;
};

export const desktopServe = async (
  resolveArgs: ResolveServerTargetArgs,
  debug: boolean,
): Promise<void> => {
  if (debug) {
    // a report cannot know in advance which decision went wrong, so every namespace
    process.env.INTELIGIR_DEBUG = DEBUG_NAMESPACES.join(",");
  }
  const version = readCliVersion();
  const resolved = resolveServerTarget(resolveArgs);
  if (resolved.kind === "refused") {
    await announce({ kind: "refused", reason: resolved.error });
    process.exit(1);
  }
  const { dataDir } = resolved.target;
  const plan = planServerStart(await verifyServer(dataDir, version), dataDir);
  if (plan.kind === "refuse") {
    await announce({ kind: "refused", reason: plan.reason });
    process.exit(1);
  }
  if (plan.kind === "adopt") {
    const adoption = await adoptServer(plan.live, dataDir);
    if (adoption.kind === "refused") {
      await announce(adoption);
      process.exit(1);
    }
    await announce({
      handoffUrl: adoption.handoffUrl,
      kind: "adopted",
      origin: plan.live.origin,
    });
    process.exit(0);
  }
  // the shell holds stdin's other end and never writes it, so it ends only when the shell is gone
  const options: RunServeOptions = { lifeline: process.stdin };
  // dynamic: the shell's other questions load no server
  const { runServe } = await import("../server/serve");
  const { serverUrl, uiUrl } = await runServe(version, {}, options);
  if (uiUrl === null) {
    await announce({
      kind: "refused",
      reason:
        "This install ships no workspace UI, so there is nothing to open. Reinstall Inteligir.",
    });
    process.kill(process.pid, "SIGTERM");
    return;
  }
  await announce({
    handoffUrl: uiUrl,
    kind: "ready",
    origin: serverUrl,
    stopGraceMs: SHUTDOWN_TIMEOUT_MS + STOP_GRACE_HEADROOM_MS,
  });
};
