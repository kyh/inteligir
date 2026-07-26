import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { hardenAppDir } from "../harden-app-dir";

// Mirrors @repo/agent/paths SESSION_DIR_SEGMENTS (the production caller threads
// it in; storage tests stay agent-free).
const SESSION_DIRS = ["sessions", "sessions/background", "sessions/inline-ai"];

// The sweep's job is whatever is ALREADY on disk: dirs and files sitting at
// looser modes than owner-only, plus pi's 0644 session transcripts. Build a
// worst-case pre-existing install in a temp root and assert the sweep
// normalizes exactly the private surface — and nothing else.

const mode = (p: string) => fs.statSync(p).mode & 0o777;

function writeFile(p: string, fileMode: number): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "x", { encoding: "utf8", mode: fileMode });
  fs.chmodSync(p, fileMode); // mode option applies on create only — force it
}

function buildLegacyInstall(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harden-app-dir-"));
  fs.chmodSync(root, 0o755);
  // Session transcripts (note content) in all three session dirs, 0644.
  writeFile(path.join(root, "sessions", "user.jsonl"), 0o644);
  writeFile(path.join(root, "sessions", "background", "bg.jsonl"), 0o644);
  writeFile(path.join(root, "sessions", "inline-ai", "ai.jsonl"), 0o644);
  fs.chmodSync(path.join(root, "sessions"), 0o755);
  fs.chmodSync(path.join(root, "sessions", "background"), 0o755);
  fs.chmodSync(path.join(root, "sessions", "inline-ai"), 0o755);
  // Top-level stores + quarantine/backup siblings, 0644.
  writeFile(path.join(root, "delegations.json"), 0o644);
  writeFile(path.join(root, "delegations.json.corrupt-123"), 0o644);
  writeFile(path.join(root, "runtime-ui.json.bak-456"), 0o644);
  // Snapshot bytes (raw note content), 0644 in a 0755 dir.
  writeFile(path.join(root, "snapshots", "abc-def"), 0o644);
  fs.chmodSync(path.join(root, "snapshots"), 0o755);
  // The knowledge index — full plaintext note bodies — and its WAL/SHM, 0644
  // in a 0755 dir (the exact gap the boot sweep must close).
  writeFile(path.join(root, "indexes", "deadbeef.sqlite"), 0o644);
  writeFile(path.join(root, "indexes", "deadbeef.sqlite-wal"), 0o644);
  writeFile(path.join(root, "indexes", "deadbeef.sqlite-shm"), 0o644);
  fs.chmodSync(path.join(root, "indexes"), 0o755);
  // Must be left alone: executables keep the owner exec bit, and non-store
  // top-level files (AGENTS.md) are not data files.
  writeFile(path.join(root, "bin", "some-tool"), 0o755);
  writeFile(path.join(root, "AGENTS.md"), 0o644);
  return root;
}

describe("hardenAppDir", () => {
  it("chmods private dirs 0700 and data files 0600, leaving bin/ and docs alone", () => {
    const root = buildLegacyInstall();
    hardenAppDir(SESSION_DIRS, root);

    expect(mode(root)).toBe(0o700);
    expect(mode(path.join(root, "sessions"))).toBe(0o700);
    expect(mode(path.join(root, "sessions", "background"))).toBe(0o700);
    expect(mode(path.join(root, "sessions", "inline-ai"))).toBe(0o700);
    expect(mode(path.join(root, "snapshots"))).toBe(0o700);
    expect(mode(path.join(root, "indexes"))).toBe(0o700);

    expect(mode(path.join(root, "sessions", "user.jsonl"))).toBe(0o600);
    expect(mode(path.join(root, "sessions", "background", "bg.jsonl"))).toBe(0o600);
    expect(mode(path.join(root, "sessions", "inline-ai", "ai.jsonl"))).toBe(0o600);
    expect(mode(path.join(root, "delegations.json"))).toBe(0o600);
    expect(mode(path.join(root, "delegations.json.corrupt-123"))).toBe(0o600);
    expect(mode(path.join(root, "runtime-ui.json.bak-456"))).toBe(0o600);
    expect(mode(path.join(root, "snapshots", "abc-def"))).toBe(0o600);
    expect(mode(path.join(root, "indexes", "deadbeef.sqlite"))).toBe(0o600);
    expect(mode(path.join(root, "indexes", "deadbeef.sqlite-wal"))).toBe(0o600);
    expect(mode(path.join(root, "indexes", "deadbeef.sqlite-shm"))).toBe(0o600);

    // Untouched: the exec bit survives, docs stay as they were.
    expect(mode(path.join(root, "bin", "some-tool"))).toBe(0o755);
    expect(mode(path.join(root, "AGENTS.md"))).toBe(0o644);
  });

  it("is a no-op on a missing root and tolerates absent subdirs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "harden-app-dir-empty-"));
    // No sessions/, no snapshots/, no files — must not throw.
    hardenAppDir(SESSION_DIRS, root);
    expect(mode(root)).toBe(0o700);
    hardenAppDir(SESSION_DIRS, path.join(root, "does-not-exist"));
  });
});
