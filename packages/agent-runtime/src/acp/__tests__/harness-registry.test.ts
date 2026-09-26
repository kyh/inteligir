import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HARNESS_IDS, HARNESSES } from "../harness-registry";

const dirs: string[] = [];

const readClaude = (stdout: string, code = 0) =>
  HARNESSES.claude.accountProbe.read({ code, stderr: "", stdout });

const readCodex = (code: number, stderr: string) =>
  HARNESSES.codex.accountProbe.read({ code, stderr, stdout: "" });

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("a harness's vendor executable", () => {
  it.each(HARNESS_IDS)("resolves the %s binary bundled beside its adapter", (id) => {
    const executable = HARNESSES[id].vendorExecutable(process.env);
    expect(executable).not.toBeNull();
    expect(() => {
      accessSync(executable ?? "", constants.X_OK);
    }).not.toThrow();
  });

  it("never consults PATH", () => {
    for (const id of HARNESS_IDS) {
      expect(HARNESSES[id].vendorExecutable({ PATH: "/nonexistent-dir" })).not.toBeNull();
    }
  });

  it("answers the override the adapter would honour, and null when it names nothing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "harness-registry-"));
    dirs.push(dir);
    const chosen = path.join(dir, "vendor");
    writeFileSync(chosen, "#!/bin/sh\n", { mode: 0o755 });
    const missing = path.join(dir, "gone");
    expect(HARNESSES.claude.vendorExecutable({ CLAUDE_CODE_EXECUTABLE: chosen })).toBe(chosen);
    expect(HARNESSES.claude.vendorExecutable({ CLAUDE_CODE_EXECUTABLE: missing })).toBeNull();
    expect(HARNESSES.codex.vendorExecutable({ CODEX_PATH: chosen })).toBe(chosen);
    expect(HARNESSES.codex.vendorExecutable({ CODEX_PATH: missing })).toBeNull();
  });
});

describe("claude's account probe", () => {
  it("reads a subscription login as its plan and email", () => {
    expect(
      readClaude(
        JSON.stringify({
          apiProvider: "firstParty",
          authMethod: "claude.ai",
          email: "ada@example.com",
          loggedIn: true,
          subscriptionType: "max",
        }),
      ),
    ).toEqual({ email: "ada@example.com", label: "Claude Max", state: "signed-in" });
  });

  it("reads the logged-out JSON it prints with exit 1 as signed out", () => {
    expect(
      readClaude(
        JSON.stringify({ apiProvider: "firstParty", authMethod: "none", loggedIn: false }),
        1,
      ),
    ).toEqual({ state: "signed-out" });
  });

  it("counts an API key as signed in, since that is what pays for a turn", () => {
    expect(readClaude(JSON.stringify({ apiKeySource: "env", loggedIn: false }))).toEqual({
      email: null,
      label: "Anthropic API key",
      state: "signed-in",
    });
  });

  it("is unknown for output it cannot read, never signed out", () => {
    expect(readClaude("claude: command failed", 2)).toMatchObject({ state: "unknown" });
    expect(readClaude(JSON.stringify({ status: "ok" }))).toMatchObject({ state: "unknown" });
  });
});

describe("codex's account probe", () => {
  it("reads exit 0 as signed in, labelled by the login method", () => {
    expect(readCodex(0, "Logged in using ChatGPT\n")).toEqual({
      email: null,
      label: "ChatGPT",
      state: "signed-in",
    });
  });

  it("never carries an API key's tail into the label", () => {
    expect(readCodex(0, "Logged in using an API key - sk-proj-***abcd\n")).toEqual({
      email: null,
      label: "API key",
      state: "signed-in",
    });
  });

  it("separates signed out from a check that failed, both exit 1", () => {
    expect(readCodex(1, "Not logged in\n")).toEqual({ state: "signed-out" });
    expect(readCodex(1, "Error checking login status: permission denied\n")).toEqual({
      detail: "Error checking login status: permission denied",
      state: "unknown",
    });
  });
});

const acceptsClaudeCode = (code: string): boolean => {
  const method = HARNESSES.claude.signIn;
  return method.kind === "terminal" && method.acceptsCode(code);
};

describe("claude's pasted sign-in code", () => {
  it("takes the page's whole code, as the vendor would", () => {
    expect(acceptsClaudeCode("abc123#state456")).toBe(true);
    expect(acceptsClaudeCode("  abc123#state456\n")).toBe(true);
  });

  it("refuses a code missing either half, which the vendor would answer only on stderr", () => {
    expect(acceptsClaudeCode("abc123")).toBe(false);
    expect(acceptsClaudeCode("abc123#")).toBe(false);
    expect(acceptsClaudeCode("#state456")).toBe(false);
  });
});
