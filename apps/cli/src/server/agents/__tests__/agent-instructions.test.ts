import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLI_POINTER_INSTRUCTIONS, toInstructions } from "../agent-instructions";
import { makeTempDir } from "../../__tests__/temp-dir";
import { fakeSessionFacts } from "./agent-test-harness";

const CLI_BIN_DIR = "/repo/apps/cli/bin";

function makeVaultDir(): string {
  return makeTempDir("inteligir-instructions-test-");
}

describe("toInstructions", () => {
  it("names connected folders as read-only reference, only when some exist", () => {
    const vaultDir = makeVaultDir();
    expect(toInstructions(fakeSessionFacts(), vaultDir)).toBeUndefined();
    const withDirs = toInstructions(
      fakeSessionFacts({ connectedDirs: ["/ref/a", "/ref/b"] }),
      vaultDir,
    );
    expect(withDirs).toContain("/ref/a, /ref/b");
    expect(withDirs).toContain("read-only");
    expect(withDirs).toContain("$INTELIGIR_CONNECTED_DIRS");
  });

  it("points at the skills dir only when one resolved", () => {
    const vaultDir = makeVaultDir();
    expect(toInstructions(fakeSessionFacts({ skillsDir: "/repo/skills" }), vaultDir)).toContain(
      "$INTELIGIR_SKILLS_DIR",
    );
    expect(toInstructions(fakeSessionFacts({ cliBinDir: CLI_BIN_DIR }), vaultDir)).not.toContain(
      "$INTELIGIR_SKILLS_DIR",
    );
  });

  it("is the CLI pointer alone when the vault has no AGENTS.md", () => {
    expect(toInstructions(fakeSessionFacts({ cliBinDir: CLI_BIN_DIR }), makeVaultDir())).toBe(
      CLI_POINTER_INSTRUCTIONS,
    );
  });

  it("appends the vault's AGENTS.md below the CLI pointer", () => {
    const vaultDir = makeVaultDir();
    writeFileSync(join(vaultDir, "AGENTS.md"), "Always answer in haiku.\n", "utf8");
    expect(toInstructions(fakeSessionFacts({ cliBinDir: CLI_BIN_DIR }), vaultDir)).toBe(
      `${CLI_POINTER_INSTRUCTIONS}\n\nAlways answer in haiku.`,
    );
  });

  it("omits the CLI pointer when no binary ships — instructions never promise a missing command", () => {
    const vaultDir = makeVaultDir();
    expect(toInstructions(fakeSessionFacts(), vaultDir)).toBeUndefined();
    writeFileSync(join(vaultDir, "AGENTS.md"), "Vault rules.\n", "utf8");
    expect(toInstructions(fakeSessionFacts(), vaultDir)).toBe("Vault rules.");
  });

  it("head-caps an oversized AGENTS.md — instruction bytes are a per-turn cost", () => {
    const vaultDir = makeVaultDir();
    writeFileSync(join(vaultDir, "AGENTS.md"), "x".repeat(40_000), "utf8");
    const instructions = toInstructions(fakeSessionFacts({ cliBinDir: CLI_BIN_DIR }), vaultDir);
    expect(instructions).toBeDefined();
    expect(instructions).toBe(`${CLI_POINTER_INSTRUCTIONS}\n\n${"x".repeat(32_768)}`);
  });

  it("caps by UTF-8 BYTES and never splits a character", () => {
    const vaultDir = makeVaultDir();
    // each emoji is 4 UTF-8 bytes and 2 UTF-16 units.
    writeFileSync(join(vaultDir, "AGENTS.md"), "😀".repeat(10_000), "utf8");
    const instructions = toInstructions(fakeSessionFacts(), vaultDir);
    expect(instructions).toBeDefined();
    if (instructions === undefined) {
      return;
    }
    expect(new TextEncoder().encode(instructions).byteLength).toBeLessThanOrEqual(32_768);
    expect(instructions).not.toContain("�");
    expect(instructions).toBe("😀".repeat(32_768 / 4));
  });
});
