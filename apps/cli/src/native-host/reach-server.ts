// whether the browser's door can reach the app's server, and what it does when it cannot: a Mac
// whose first run is still waiting on the person brings the app to the front and says so; a packaged
// app that is not running is opened behind the browser and waited for, so a save from a quit app
// still lands. A dev server has nothing to start it, so it is never waited for.

import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { CliExitError } from "../cli-error";
import type { CliDeps } from "../context";
import { planLaunch } from "../desktop/first-run";
import { resolveServerTarget } from "../desktop/server-start";
import type { ResolveServerTargetArgs } from "../desktop/server-start";
import { runtimeModeOf } from "../server/config";
import { messageOf } from "../server/error-message";
import type { ResolvedServer } from "../server-discovery";
import type { OpenApp } from "./open-app";

const REACH_DEADLINE_MS = 30_000;
const POLL_INTERVAL_MS = 250;

export interface ReachDeps extends Pick<CliDeps, "env" | "homeDir" | "resolveServer"> {
  openApp: OpenApp;
}

export type Reach =
  | { kind: "reached"; server: ResolvedServer }
  | { kind: "not-set-up"; detail: string }
  | { kind: "unavailable"; detail: string }
  | { kind: "failed"; detail: string };

type Attempt =
  | { kind: "resolved"; server: ResolvedServer }
  // no server.json, or one a crash left: nothing serves
  | { kind: "absent"; detail: string }
  // a server of another release, as during an update
  | { kind: "mismatch"; detail: string }
  // anything else (an unreadable config, say), which waiting does not mend
  | { kind: "broken"; detail: string };

const attempt = (deps: Pick<ReachDeps, "resolveServer">): Attempt => {
  try {
    return { kind: "resolved", server: deps.resolveServer() };
  } catch (error) {
    if (error instanceof CliExitError && error.code === "SERVER_UNREACHABLE") {
      return { detail: error.message, kind: "absent" };
    }
    if (error instanceof CliExitError && error.code === "SERVER_VERSION_MISMATCH") {
      return { detail: error.message, kind: "mismatch" };
    }
    return { detail: messageOf(error), kind: "broken" };
  }
};

// the launch the app would plan right now: a first run boots no server until a library is chosen,
// so waiting for one would only time out
const awaitsFirstRun = (deps: Pick<ReachDeps, "env" | "homeDir">): boolean => {
  const args: ResolveServerTargetArgs = { env: deps.env };
  if (deps.homeDir !== undefined) {
    args.homeDir = deps.homeDir;
  }
  const resolved = resolveServerTarget(args);
  return (
    resolved.kind === "resolved" &&
    planLaunch({ exists: existsSync, target: resolved.target }).kind === "first-run"
  );
};

const settled = (current: Attempt): Reach | null => {
  switch (current.kind) {
    case "resolved": {
      return { kind: "reached", server: current.server };
    }
    case "broken": {
      return { detail: current.detail, kind: "failed" };
    }
    case "absent":
    case "mismatch": {
      return null;
    }
    default: {
      const exhaustive: never = current;
      return exhaustive;
    }
  }
};

export const reachServer = async (
  deps: ReachDeps,
  deadlineMs: number = REACH_DEADLINE_MS,
): Promise<Reach> => {
  const deadline = Date.now() + deadlineMs;
  const current = attempt(deps);
  if (current.kind === "resolved") {
    return { kind: "reached", server: current.server };
  }
  if (current.kind === "broken") {
    return { detail: current.detail, kind: "failed" };
  }
  const packaged = runtimeModeOf(deps.env) === "prod";
  if (current.kind === "absent") {
    if (awaitsFirstRun(deps)) {
      deps.openApp("front");
      return { detail: current.detail, kind: "not-set-up" };
    }
    // once: a second open while the first is still launching would bring the window forward
    if (!packaged || !deps.openApp("behind")) {
      return { detail: current.detail, kind: "unavailable" };
    }
  } else if (!packaged) {
    return { detail: current.detail, kind: "unavailable" };
  }
  let { detail } = current;
  while (Date.now() < deadline) {
    await delay(Math.min(POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
    const next = attempt(deps);
    const reached = settled(next);
    if (reached !== null) {
      return reached;
    }
    if (next.kind === "absent" || next.kind === "mismatch") {
      ({ detail } = next);
    }
  }
  return { detail, kind: "unavailable" };
};
