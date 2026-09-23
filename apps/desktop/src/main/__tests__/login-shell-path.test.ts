import { describe, expect, it } from "vitest";
import {
  mergePath,
  parseMarkedPath,
  PATH_MARKER,
  resolveShellPath,
  runShell,
} from "../login-shell-path";
import type { RunShell, ShellPathArgs } from "../login-shell-path";

const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const HOME = "/Users/someone";

const marked = (printed: string): string => `${PATH_MARKER}\n${printed}\n${PATH_MARKER}\n`;

interface Recorded {
  calls: { shell: string; args: readonly string[] }[];
}

const recording = (answer: RunShell): RunShell & Recorded => {
  const calls: Recorded["calls"] = [];
  const run: RunShell = async (shell, args, timeoutMs) => {
    calls.push({ args, shell });
    return await answer(shell, args, timeoutMs);
  };
  return Object.assign(run, { calls });
};

const shellArgs = (overrides: Partial<ShellPathArgs> = {}): ShellPathArgs => ({
  env: { PATH: LAUNCHD_PATH, SHELL: "/bin/zsh" },
  homeDir: HOME,
  isDirectory: () => true,
  isPackaged: true,
  platform: "darwin",
  run: async () => await Promise.resolve(marked("/opt/homebrew/bin:/usr/bin")),
  ...overrides,
});

describe("parseMarkedPath", () => {
  it("reads only what sits between the markers, whatever the rc files printed", () => {
    const stdout = [
      "Last login: Mon Sep 22 09:14:03 on ttys001",
      "\u001B[32m[oh-my-zsh] welcome back\u001B[0m",
      marked(`${HOME}/.local/bin:/opt/homebrew/bin:/usr/bin`),
      "Saving session...completed.",
    ].join("\n");
    expect(parseMarkedPath(stdout)).toBe(`${HOME}/.local/bin:/opt/homebrew/bin:/usr/bin`);
  });

  it("answers null for no markers, one marker, or nothing between them", () => {
    expect(parseMarkedPath("/usr/bin:/bin\n")).toBeNull();
    expect(parseMarkedPath(`${PATH_MARKER}\n/usr/bin`)).toBeNull();
    expect(parseMarkedPath(marked("  "))).toBeNull();
  });
});

describe("mergePath", () => {
  it("puts the first entries ahead and keeps each directory once, at its first place", () => {
    expect(mergePath(["/opt/homebrew/bin", "/usr/bin"], "/usr/bin:/bin:/custom/bin")).toBe(
      "/opt/homebrew/bin:/usr/bin:/bin:/custom/bin",
    );
  });

  it("drops empty entries, which PATH lookup would read as the working directory", () => {
    const noPath: NodeJS.ProcessEnv = {};
    expect(mergePath(["", "/a"], ":/b::")).toBe("/a:/b");
    expect(mergePath(["/a"], noPath.PATH)).toBe("/a");
  });
});

describe("resolveShellPath", () => {
  it("asks the user's login shell and puts its entries ahead of launchd's", async () => {
    const run = recording(
      async () =>
        await Promise.resolve(
          `motd noise\n${marked(`${HOME}/.local/bin:/opt/homebrew/bin:/usr/bin:/bin`)}`,
        ),
    );
    const resolved = await resolveShellPath(
      shellArgs({ env: { PATH: LAUNCHD_PATH, SHELL: "/opt/homebrew/bin/fish" }, run }),
    );
    expect(resolved).toEqual({
      path: `${HOME}/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      source: "login-shell",
    });
    expect(run.calls.map((call) => call.shell)).toEqual(["/opt/homebrew/bin/fish"]);
    expect(run.calls[0]?.args[0]).toBe("-ilc");
  });

  it("falls back to zsh when SHELL is unset or not an absolute path", async () => {
    const unset = recording(async () => await Promise.resolve(marked("/usr/bin")));
    await resolveShellPath(shellArgs({ env: { PATH: LAUNCHD_PATH }, run: unset }));
    const bare = recording(async () => await Promise.resolve(marked("/usr/bin")));
    await resolveShellPath(shellArgs({ env: { PATH: LAUNCHD_PATH, SHELL: "zsh" }, run: bare }));
    expect([...unset.calls, ...bare.calls].map((call) => call.shell)).toEqual([
      "/bin/zsh",
      "/bin/zsh",
    ]);
  });

  it("on a timeout, adds the usual install dirs that exist ahead of launchd's PATH", async () => {
    const present = new Set([`${HOME}/.local/bin`, "/opt/homebrew/bin"]);
    const resolved = await resolveShellPath(
      shellArgs({
        isDirectory: (dir) => present.has(dir),
        run: async () => {
          throw new Error("/bin/zsh did not answer within 5000ms");
        },
      }),
    );
    expect(resolved).toEqual({
      path: `${HOME}/.local/bin:/opt/homebrew/bin:${LAUNCHD_PATH}`,
      reason: "/bin/zsh did not answer within 5000ms",
      source: "fallback",
    });
  });

  it("falls back when the shell printed no PATH between the markers", async () => {
    const resolved = await resolveShellPath(
      shellArgs({
        isDirectory: (dir) => dir === "/usr/local/bin",
        run: async () => await Promise.resolve("zsh: command not found: compinit\n"),
      }),
    );
    expect(resolved).toEqual({
      path: `/usr/local/bin:${LAUNCHD_PATH}`,
      reason: "/bin/zsh printed no PATH",
      source: "fallback",
    });
  });

  it("leaves PATH to the launch everywhere but a packaged macOS app, and runs no shell", async () => {
    const run = recording(async () => await Promise.resolve(marked("/opt/homebrew/bin")));
    expect(await resolveShellPath(shellArgs({ platform: "linux", run }))).toEqual({
      source: "inherited",
    });
    expect(await resolveShellPath(shellArgs({ platform: "win32", run }))).toEqual({
      source: "inherited",
    });
    expect(await resolveShellPath(shellArgs({ isPackaged: false, run }))).toEqual({
      source: "inherited",
    });
    expect(run.calls).toEqual([]);
  });
});

describe("runShell", () => {
  it("answers what the command printed", async () => {
    await expect(runShell("/bin/sh", ["-c", "echo one; echo two"], 5000)).resolves.toBe(
      "one\ntwo\n",
    );
  });

  it("gives up at the limit instead of waiting on a shell that never finishes", async () => {
    const started = Date.now();
    await expect(runShell("/bin/sh", ["-c", "sleep 30"], 100)).rejects.toThrow(
      "/bin/sh did not answer within 100ms",
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("stops waiting when something the shell started holds its stdout past its exit", async () => {
    await expect(runShell("/bin/sh", ["-c", "sleep 30 & echo started"], 200)).rejects.toThrow(
      "/bin/sh did not answer within 200ms",
    );
  });

  it("rejects a shell that does not exist", async () => {
    await expect(runShell("/nonexistent/shell", ["-c", "true"], 5000)).rejects.toThrow(/ENOENT/u);
  });
});
