import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLI_POINTER_INSTRUCTIONS, loadAgentInstructions } from "../agent-instructions";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function makeVaultDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-instructions-test-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("loadAgentInstructions", () => {
  it("is the CLI pointer alone when the vault has no AGENTS.md", () => {
    expect(loadAgentInstructions(makeVaultDir())).toBe(CLI_POINTER_INSTRUCTIONS);
  });

  it("appends the vault's AGENTS.md below the CLI pointer", () => {
    const vaultDir = makeVaultDir();
    writeFileSync(join(vaultDir, "AGENTS.md"), "Always answer in haiku.\n", "utf8");
    expect(loadAgentInstructions(vaultDir)).toBe(
      `${CLI_POINTER_INSTRUCTIONS}\n\nAlways answer in haiku.`,
    );
  });

  it("head-caps an oversized AGENTS.md — instruction bytes are a per-turn cost", () => {
    const vaultDir = makeVaultDir();
    writeFileSync(join(vaultDir, "AGENTS.md"), "x".repeat(40_000), "utf8");
    const instructions = loadAgentInstructions(vaultDir);
    expect(instructions.length).toBe(CLI_POINTER_INSTRUCTIONS.length + 2 + 32_768);
    expect(instructions.startsWith(CLI_POINTER_INSTRUCTIONS)).toBe(true);
  });
});
