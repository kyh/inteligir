import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIENCE_INSTRUCTIONS,
  CLI_POINTER_INSTRUCTIONS,
  toInstructions,
} from "../agent-instructions";
import { makeTempDir } from "../../__tests__/temp-dir";
import { fakeSessionFacts } from "./agent-test-harness";

const CLI_BIN_DIR = "/repo/apps/cli/bin";

const makeVaultDir = (): string => makeTempDir("inteligir-instructions-test-");

const afterAudience = (rest: string): string => `${AUDIENCE_INSTRUCTIONS}\n\n${rest}`;

describe("toInstructions", () => {
  it("states the audience first on every set", () => {
    const vaultDir = makeVaultDir();
    writeFileSync(path.join(vaultDir, "AGENTS.md"), "Vault rules.\n", "utf-8");
    const sets = [
      toInstructions(fakeSessionFacts(), makeVaultDir()),
      toInstructions(fakeSessionFacts({ cliBinDir: CLI_BIN_DIR }), makeVaultDir()),
      toInstructions(
        fakeSessionFacts({
          cliBinDir: CLI_BIN_DIR,
          connectedDirs: ["/ref/a"],
          skillsDir: "/repo/skills",
        }),
        vaultDir,
      ),
    ];
    for (const instructions of sets) {
      expect(instructions.startsWith(AUDIENCE_INSTRUCTIONS)).toBe(true);
    }
    expect(sets.at(-1)?.endsWith("Vault rules.")).toBe(true);
  });

  it("names connected folders as read-only reference, only when some exist", () => {
    const vaultDir = makeVaultDir();
    expect(toInstructions(fakeSessionFacts(), vaultDir)).toBe(AUDIENCE_INSTRUCTIONS);
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

  it("is the audience and the CLI pointer alone when the vault has no AGENTS.md", () => {
    expect(toInstructions(fakeSessionFacts({ cliBinDir: CLI_BIN_DIR }), makeVaultDir())).toBe(
      afterAudience(CLI_POINTER_INSTRUCTIONS),
    );
  });

  it("appends the vault's AGENTS.md below the CLI pointer", () => {
    const vaultDir = makeVaultDir();
    writeFileSync(path.join(vaultDir, "AGENTS.md"), "Always answer in haiku.\n", "utf-8");
    expect(toInstructions(fakeSessionFacts({ cliBinDir: CLI_BIN_DIR }), vaultDir)).toBe(
      afterAudience(`${CLI_POINTER_INSTRUCTIONS}\n\nAlways answer in haiku.`),
    );
  });

  it("omits the CLI pointer when no binary ships — instructions never promise a missing command", () => {
    const vaultDir = makeVaultDir();
    expect(toInstructions(fakeSessionFacts(), vaultDir)).toBe(AUDIENCE_INSTRUCTIONS);
    writeFileSync(path.join(vaultDir, "AGENTS.md"), "Vault rules.\n", "utf-8");
    expect(toInstructions(fakeSessionFacts(), vaultDir)).toBe(afterAudience("Vault rules."));
  });

  it("head-caps an oversized AGENTS.md — instruction bytes are a per-turn cost", () => {
    const vaultDir = makeVaultDir();
    writeFileSync(path.join(vaultDir, "AGENTS.md"), "x".repeat(40_000), "utf-8");
    expect(toInstructions(fakeSessionFacts({ cliBinDir: CLI_BIN_DIR }), vaultDir)).toBe(
      afterAudience(`${CLI_POINTER_INSTRUCTIONS}\n\n${"x".repeat(32_768)}`),
    );
  });

  it("caps by UTF-8 BYTES and never splits a character", () => {
    const vaultDir = makeVaultDir();
    // each emoji is 4 UTF-8 bytes and 2 UTF-16 units.
    writeFileSync(path.join(vaultDir, "AGENTS.md"), "😀".repeat(10_000), "utf-8");
    const vaultPart = toInstructions(fakeSessionFacts(), vaultDir).slice(afterAudience("").length);
    expect(new TextEncoder().encode(vaultPart).byteLength).toBeLessThanOrEqual(32_768);
    expect(vaultPart).not.toContain("�");
    expect(vaultPart).toBe("😀".repeat(32_768 / 4));
  });
});
