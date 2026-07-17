// ---------------------------------------------------------------------------
// hardenAppDir — best-effort, once-per-boot permission sweep of ~/.inteligir.
//
// New writes are already owner-only: json-store's realFs defaults data files
// to 0o600, its mkdirs are 0o700, and restrictInteligirDir keeps the TOP dir
// 0700 on every store write. What none of that can fix is history and third
// parties: files created 0644 by older builds (sessions/*.jsonl transcripts
// record every note the agent read; delegations.json; runtime-ui.json;
// snapshot bytes are raw note content), subdirectories created 0755, and pi —
// which owns the session writers and keeps creating transcripts 0644
// mid-session. A 0700 directory is the durable boundary for those; this sweep
// normalizes the directories and heals the file-mode stragglers each launch.
//
// Deliberately SKIPPED: bin/ and extensions/ (executables need the owner exec
// bit and are not note content), workspace/ (holds the vault symlink — the
// vault is user-owned data, not ours to chmod), skills/ (bundled prompts).
// pi's auth.json is pi-owned and already 0600 upstream; the top-level *.json
// chmod re-asserts that without changing pi's contract.
//
// Every chmod runs in its own try/catch — a dead path (file vanished
// mid-sweep, exotic filesystem) must never block boot. chmod by path while pi
// holds a session file open is safe on POSIX (permissions live on the inode).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

import { inteligirPath } from "./json-store";

/** Subdirectories holding note content, transcripts, or credentials — the
 * durable owner-only boundary for files third parties create inside them. */
const PRIVATE_DIRS = [
  "sessions",
  "sessions/background",
  "sessions/inline-ai",
  "snapshots",
  "indexes",
  "logs",
  "executor",
  "chrome-profile",
];

/** The pi session dirs whose *.jsonl transcripts get file-mode healing (one
 * level deep — pi writes flat files, no nesting). */
const SESSION_DIRS = ["sessions", "sessions/background", "sessions/inline-ai"];

function chmodQuiet(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Best-effort — never block boot on a permission fix.
  }
}

/** File names directly inside `dir`; [] when the dir doesn't exist. */
function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Sweep the app dir's permissions: 0700 on the dir + its private subdirs,
 * 0600 on data files (top-level *.json and their .corrupt- / .newer- / .bak-
 * siblings, session *.jsonl transcripts, snapshot bytes). `root` is
 * injectable for tests; production callers use the default. */
export function hardenAppDir(root: string = inteligirPath()): void {
  if (!fs.existsSync(root)) return;
  chmodQuiet(root, 0o700);
  for (const rel of PRIVATE_DIRS) {
    const dir = path.join(root, rel);
    if (fs.existsSync(dir)) chmodQuiet(dir, 0o700);
  }
  // Top-level stores: `.json` as a substring also catches the quarantine /
  // backup / tmp siblings (delegations.json.corrupt-<ts>, *.json.newer-v*-*,
  // *.json.bak-*, *.json.tmp) that carry the same data.
  for (const name of listFiles(root)) {
    if (name.includes(".json")) chmodQuiet(path.join(root, name), 0o600);
  }
  for (const rel of SESSION_DIRS) {
    const dir = path.join(root, rel);
    for (const name of listFiles(dir)) {
      if (name.endsWith(".jsonl")) chmodQuiet(path.join(dir, name), 0o600);
    }
  }
  // Snapshot bytes are raw note content — every regular file in the dir.
  const snapshots = path.join(root, "snapshots");
  for (const name of listFiles(snapshots)) {
    chmodQuiet(path.join(snapshots, name), 0o600);
  }
  // The knowledge index sqlite is the ONLY full plaintext copy of every note
  // body (FTS5 body column — `private: true` notes included; is_private only
  // prefilters queries). Chmod the whole trio (.sqlite + -wal + -shm) — a WAL
  // holds unflushed body bytes just like the main db.
  const indexes = path.join(root, "indexes");
  for (const name of listFiles(indexes)) {
    chmodQuiet(path.join(indexes, name), 0o600);
  }
}
