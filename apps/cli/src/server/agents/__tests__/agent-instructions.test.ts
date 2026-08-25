import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLI_POINTER_INSTRUCTIONS, loadAgentInstructions } from "../agent-instructions";
import { makeTempDir } from "../../__tests__/temp-dir";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const CLI_BIN_DIR = "/repo/apps/cli/bin";

function makeVaultDir(): string {
  const dir = makeTempDir("inteligir-instructions-test-");
  return dir;
}

describe("loadAgentInstructions", () => {
  it("names connected folders as read-only reference, only when some exist", () => {
    const vaultDir = makeVaultDir();
    expect(loadAgentInstructions(vaultDir, null, null, [])).toBeUndefined();
    const withDirs = loadAgentInstructions(vaultDir, null, null, ["/ref/a", "/ref/b"]);
    expect(withDirs).toContain("/ref/a, /ref/b");
    expect(withDirs).toContain("read-only");
    expect(withDirs).toContain("$INTELIGIR_CONNECTED_DIRS");
  });

  it("is the CLI pointer alone when the vault has no AGENTS.md", () => {
    expect(loadAgentInstructions(makeVaultDir(), CLI_BIN_DIR)).toBe(CLI_POINTER_INSTRUCTIONS);
  });

  it("appends the vault's AGENTS.md below the CLI pointer", () => {
    const vaultDir = makeVaultDir();
    writeFileSync(join(vaultDir, "AGENTS.md"), "Always answer in haiku.\n", "utf8");
    expect(loadAgentInstructions(vaultDir, CLI_BIN_DIR)).toBe(
      `${CLI_POINTER_INSTRUCTIONS}\n\nAlways answer in haiku.`,
    );
  });

  it("omits the CLI pointer when no binary ships — instructions never promise a missing command", () => {
    const vaultDir = makeVaultDir();
    expect(loadAgentInstructions(vaultDir, null)).toBeUndefined();
    writeFileSync(join(vaultDir, "AGENTS.md"), "Vault rules.\n", "utf8");
    expect(loadAgentInstructions(vaultDir, null)).toBe("Vault rules.");
  });

  it("head-caps an oversized AGENTS.md — instruction bytes are a per-turn cost", () => {
    const vaultDir = makeVaultDir();
    writeFileSync(join(vaultDir, "AGENTS.md"), "x".repeat(40_000), "utf8");
    const instructions = loadAgentInstructions(vaultDir, CLI_BIN_DIR);
    expect(instructions).toBeDefined();
    expect(instructions).toBe(`${CLI_POINTER_INSTRUCTIONS}\n\n${"x".repeat(32_768)}`);
  });

  it("caps by UTF-8 BYTES and never splits a character", () => {
    const vaultDir = makeVaultDir();
    // Each emoji is 4 UTF-8 bytes and 2 UTF-16 units: measuring `.length`
    // would keep ~4x the budget, and slicing by it would halve a surrogate
    // pair into U+FFFD.
    writeFileSync(join(vaultDir, "AGENTS.md"), "😀".repeat(10_000), "utf8");
    const instructions = loadAgentInstructions(vaultDir, null);
    expect(instructions).toBeDefined();
    if (instructions === undefined) {
      return;
    }
    expect(new TextEncoder().encode(instructions).byteLength).toBeLessThanOrEqual(32_768);
    expect(instructions).not.toContain("�");
    expect(instructions).toBe("😀".repeat(32_768 / 4));
  });
});
