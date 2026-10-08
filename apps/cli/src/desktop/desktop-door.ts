// The questions the desktop shell asks the CLI. The shell is Rust, and every rule it acts by that is
// the server's own is the TypeScript here, so none is spelled twice: the environment a launch runs
// the server with, the data dir it serves, a browser's sign-in. Each answers `{ answer }`, or
// `{ reason }` for a refusal in the person's words; anything thrown is a fault. desktop-entry.ts
// asks one per process.

import { existsSync } from "node:fs";
import { readCliVersion } from "../paths";
import { isDirectory, resolveShellPath, runShell } from "./login-shell-path";
import {
  browserSignInUrl,
  describeServerVerdict,
  resolveServerTarget,
  verifyServer,
} from "./server-start";
import type { ResolveServerTargetArgs } from "./server-start";

export type DoorReply = { answer: unknown } | { reason: string };

export interface DoorContext {
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

// the shell states the mode: a packaged app is production whatever its launch environment says
export const doorTargetArgs = (context: DoorContext): ResolveServerTargetArgs => ({
  env: context.env,
  homeDir: context.homeDir,
  isPackaged: context.env.NODE_ENV === "production",
});

// the login shell's PATH, answered as what every node child the shell starts after runs with, the
// data dir the launch serves, and whether it is the first: a data dir no server has opened yet
// holds no thread log, so its window lands on /welcome rather than the workspace
const launch = async (context: DoorContext): Promise<DoorReply> => {
  const { isPackaged } = doorTargetArgs(context);
  const notes: string[] = [];
  const env: Record<string, string> = {};
  const shellPath = await resolveShellPath({
    env: context.env,
    homeDir: context.homeDir,
    isDirectory,
    isPackaged,
    platform: process.platform,
    run: runShell,
  });
  if (shellPath.source !== "inherited") {
    if (shellPath.source === "fallback") {
      notes.push(
        `could not read the login shell's PATH (${shellPath.reason}); adding the usual install dirs instead`,
      );
    }
    env.PATH = shellPath.path;
  }
  const resolved = resolveServerTarget(doorTargetArgs(context));
  if (resolved.kind === "refused") {
    return { reason: resolved.error };
  }
  const { dataDir, databasePath } = resolved.target;
  return {
    answer: { env, firstLaunch: !existsSync(databasePath), notes, target: { dataDir } },
  };
};

// a browser holds no bearer, so "Open in Browser" signs one in through a handoff
const handoff = async (context: DoorContext): Promise<DoorReply> => {
  const resolved = resolveServerTarget(doorTargetArgs(context));
  if (resolved.kind === "refused") {
    return { reason: resolved.error };
  }
  const { dataDir } = resolved.target;
  const verdict = await verifyServer(dataDir, readCliVersion());
  return verdict.kind === "verified"
    ? { answer: { url: await browserSignInUrl(verdict.live) } }
    : { reason: describeServerVerdict(verdict, dataDir) };
};

export const answerDoor = async (
  context: DoorContext,
  verb: string | undefined,
): Promise<DoorReply> => {
  switch (verb) {
    case "launch": {
      return await launch(context);
    }
    case "handoff": {
      return await handoff(context);
    }
    default: {
      throw new Error(`the desktop entry answers no "${String(verb)}"`);
    }
  }
};
