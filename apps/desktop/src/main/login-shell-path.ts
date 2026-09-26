// A Finder or Dock launch inherits launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin), and the agent's
// bash and the vendor's stdio MCP servers run the user's own commands by name. The user's PATH is
// written down in their login shell, so main asks it once before the first fork.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { statSync } from "node:fs";
import path from "node:path";
import { toErrorMessage } from "../types";

const RESOLVE_TIMEOUT_MS = 5000;
const DEFAULT_SHELL = "/bin/zsh";
// rc files print banners, motds and prompts to stdout; only what sits between the markers is the PATH
export const PATH_MARKER = "__INTELIGIR_LOGIN_SHELL_PATH__";
// printenv reads the exported variable, so fish's list-valued PATH is colon-joined like everyone else's
const PRINT_PATH = `echo ${PATH_MARKER}; /usr/bin/printenv PATH; echo ${PATH_MARKER}`;

export type RunShell = (
  shell: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<string>;

export interface ShellPathArgs {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  // a dev launch comes from a terminal whose PATH is already the user's, and may be ordered on
  // purpose; a packaged one goes through LaunchServices, `open` included, and gets launchd's
  isPackaged: boolean;
  isDirectory: (dir: string) => boolean;
  platform: NodeJS.Platform;
  run: RunShell;
}

export type ShellPathResolution =
  | { source: "inherited" }
  | { source: "login-shell"; path: string }
  | { source: "fallback"; path: string; reason: string };

export const parseMarkedPath = (stdout: string): string | null => {
  const parts = stdout.split(PATH_MARKER);
  if (parts.length < 3) {
    return null;
  }
  const printed = parts[1]?.trim() ?? "";
  return printed === "" ? null : printed;
};

// first wins, so the login shell's order decides which of two installs of a binary runs
export const mergePath = (first: readonly string[], inherited: string | undefined): string => {
  const entries = [...first, ...(inherited ?? "").split(path.delimiter)].filter(
    (entry) => entry !== "",
  );
  return [...new Set(entries)].join(path.delimiter);
};

// where per-user installers and Homebrew put binaries
const wellKnownDirs = (homeDir: string): string[] => [
  path.join(homeDir, ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

// absolute or nothing: a bare name would be looked up on the very PATH this is fixing
const loginShell = (env: NodeJS.ProcessEnv): string => {
  const configured = env.SHELL;
  return configured !== undefined && path.isAbsolute(configured) ? configured : DEFAULT_SHELL;
};

export const resolveShellPath = async (args: ShellPathArgs): Promise<ShellPathResolution> => {
  if (args.platform !== "darwin" || !args.isPackaged) {
    return { source: "inherited" };
  }
  const shell = loginShell(args.env);
  let reason: string;
  try {
    const printed = parseMarkedPath(
      await args.run(shell, ["-ilc", PRINT_PATH], RESOLVE_TIMEOUT_MS),
    );
    if (printed !== null) {
      return {
        path: mergePath(printed.split(path.delimiter), args.env.PATH),
        source: "login-shell",
      };
    }
    reason = `${shell} printed no PATH`;
  } catch (error) {
    reason = toErrorMessage(error);
  }
  const fallback = wellKnownDirs(args.homeDir).filter((dir) => args.isDirectory(dir));
  return { path: mergePath(fallback, args.env.PATH), reason, source: "fallback" };
};

export const isDirectory = (dir: string): boolean => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

// the group, since what hangs is usually a command the rc file ran; SIGKILL, since an
// interactive shell ignores SIGTERM
const killGroup = (pid: number | undefined): void => {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
};

// detached: its own process group, and no terminal an interactive shell could take from a
// launch that had one. a daemon an rc file starts can hold stdout open after the shell is gone,
// and "close" waits for stdout, so the second marker ends the wait as soon as it arrives, and
// the deadline ends it for a shell that never prints both
export const runShell: RunShell = async (shell, args, timeoutMs) => {
  const child = spawn(shell, args, {
    detached: true,
    // oh-my-zsh otherwise checks for its own update over the network inside the budget
    env: { ...process.env, DISABLE_AUTO_UPDATE: "true" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  const stop = (): void => {
    child.stdout.destroy();
    killGroup(child.pid);
  };
  let stdout = "";
  child.stdout.setEncoding("utf-8");
  const marked = Promise.withResolvers<"marked">();
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    if (parseMarkedPath(stdout) !== null) {
      marked.resolve("marked");
    }
  });
  const deadline = AbortSignal.timeout(timeoutMs);
  const closed = async (): Promise<"closed"> => {
    await once(child, "close", { signal: deadline });
    return "closed";
  };
  let ended: "marked" | "closed";
  try {
    ended = await Promise.race([marked.promise, closed()]);
  } catch (error) {
    if (!deadline.aborted) {
      throw error;
    }
    stop();
    throw new Error(`${shell} did not answer within ${String(timeoutMs)}ms`, { cause: error });
  }
  if (ended === "marked") {
    stop();
  }
  return stdout;
};
