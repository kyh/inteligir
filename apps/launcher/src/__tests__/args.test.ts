import { describe, expect, it } from "vitest";
import { parseLauncherArgs, resolveLauncherEnv, type BootOptions } from "../args";

function bootOptions(argv: readonly string[]): BootOptions {
  const command = parseLauncherArgs(argv);
  if (command.kind !== "boot") {
    throw new Error(`expected a boot command, got ${command.kind}`);
  }
  return command.options;
}

describe("parseLauncherArgs", () => {
  it("boots with defaults on an empty command line", () => {
    expect(bootOptions([])).toEqual({ port: null, dataDir: null, vaultDir: null, open: true });
  });

  it("reads every value flag in both spellings", () => {
    const spaced = bootOptions(["--port", "4700", "--data-dir", "/d", "--vault", "/v"]);
    const equals = bootOptions(["--port=4700", "--data-dir=/d", "--vault=/v"]);
    expect(spaced).toEqual({ port: 4700, dataDir: "/d", vaultDir: "/v", open: true });
    expect(equals).toEqual(spaced);
  });

  it("turns opening off with --no-open", () => {
    expect(bootOptions(["--no-open"]).open).toBe(false);
  });

  it.each([
    ["-h", "help"],
    ["--help", "help"],
    ["-v", "version"],
    ["--version", "version"],
  ])("answers %s with the %s command", (flag, kind) => {
    expect(parseLauncherArgs([flag]).kind).toBe(kind);
  });

  it("answers help before acting on anything that follows it", () => {
    expect(parseLauncherArgs(["--help", "--port", "nonsense"]).kind).toBe("help");
  });

  it.each(["0", "70000", "4700.5", "abc", ""])("refuses --port %o", (raw) => {
    expect(parseLauncherArgs(["--port", raw]).kind).toBe("error");
  });

  it("refuses a value flag with nothing after it", () => {
    expect(parseLauncherArgs(["--data-dir"])).toEqual({
      kind: "error",
      message: "--data-dir needs a value.",
    });
  });

  it("refuses a value flag followed by another flag", () => {
    expect(parseLauncherArgs(["--vault", "--no-open"]).kind).toBe("error");
  });

  it("refuses an unknown option", () => {
    const command = parseLauncherArgs(["--turbo"]);
    expect(command.kind).toBe("error");
    expect(command.kind === "error" && command.message).toContain('Unknown option "--turbo"');
  });

  it("refuses a positional argument, and points at the option list", () => {
    // `inteligir vault list` is the agent-facing CLI, a different program —
    // silently booting a second server for it would be the wrong answer.
    const command = parseLauncherArgs(["vault", "list"]);
    expect(command.kind).toBe("error");
    expect(command.kind === "error" && command.message).toContain("options only");
  });
});

describe("resolveLauncherEnv", () => {
  const none: BootOptions = { port: null, dataDir: null, vaultDir: null, open: true };

  it("names nothing when nothing was given, so the app's own defaults stand", () => {
    expect(resolveLauncherEnv({ options: none, cwd: "/work" })).toEqual({});
  });

  it("maps each option onto the env var the app reads", () => {
    expect(
      resolveLauncherEnv({
        options: { ...none, port: 4700, dataDir: "/abs/data", vaultDir: "/abs/vault" },
        cwd: "/work",
      }),
    ).toEqual({
      INTELIGIR_PORT: "4700",
      INTELIGIR_DATA_DIR: "/abs/data",
      INTELIGIR_VAULT_DIR: "/abs/vault",
    });
  });

  it("resolves a relative path against the invoking cwd", () => {
    expect(
      resolveLauncherEnv({
        options: { ...none, dataDir: "notes-data", vaultDir: "./nested/vault" },
        cwd: "/work/project",
      }),
    ).toEqual({
      INTELIGIR_DATA_DIR: "/work/project/notes-data",
      INTELIGIR_VAULT_DIR: "/work/project/nested/vault",
    });
  });

  it("leaves a ~ path for the app's config layer to expand", () => {
    expect(
      resolveLauncherEnv({
        options: { ...none, dataDir: "~", vaultDir: "~/Notes" },
        cwd: "/work",
      }),
    ).toEqual({ INTELIGIR_DATA_DIR: "~", INTELIGIR_VAULT_DIR: "~/Notes" });
  });
});
