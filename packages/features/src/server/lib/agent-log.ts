// Tee main-process console output to ~/.inteligir/logs/agent.log so a broken
// install can be debugged without the dev terminal open. Mirrors EVERY
// console.warn/console.error line, plus console.log lines carrying a "[tag]"
// prefix (e.g. [agent], [machine], [pi-driver]) — untagged info lines stay
// console-only so framework noise doesn't bloat the file. Per-token streaming
// deltas ("[agent-event] message_update") are skipped: one model turn would
// otherwise amplify into thousands of file writes, and the text is
// reconstructable from the message_end line.
//
// Durability over throughput: lines are appended synchronously so they're on
// disk before a crash handler returns, and the file is recreated lazily after
// the logout wipe (teardownAgentResources rm -rf's ~/.inteligir, logs
// included — which also means logs holding message previews don't outlive a
// logout). Size-capped: rotates to agent.log.1, keeping one rotated file.
// Best-effort: write failures fall back to stderr only.

import fs from "node:fs";
import path from "node:path";

import { inteligirPath } from "./json-store";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

type ConsoleLevel = "info" | "warn" | "error";

const LEVEL_LABEL: Record<ConsoleLevel, string> = {
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

// "[tag]" at the start of an info line opts it into the file. warn/error
// lines are mirrored unconditionally.
const TAGGED_LINE = /^\[[^\]\s]+\]/;

// Hot-path guard: per-token deltas never reach the file (see module comment).
const SKIP_PREFIXES = ["[agent-event] message_update"];

function shouldMirror(level: ConsoleLevel, args: unknown[]): boolean {
  const first = args[0];
  if (typeof first === "string" && SKIP_PREFIXES.some((p) => first.startsWith(p))) {
    return false;
  }
  if (level !== "info") return true;
  return typeof first === "string" && TAGGED_LINE.test(first);
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

export type AgentLogWriter = {
  logPath: string;
  /** Mirror one console call to the file, if it qualifies (see shouldMirror). */
  append: (level: ConsoleLevel, args: unknown[]) => void;
  /** Append a raw line unconditionally (session markers, crash banners). */
  writeRaw: (line: string) => void;
};

/** Build a log writer rooted at `dir`. Exported with injectable paths/caps so
 * tests can exercise rotation and filtering against a temp dir. */
export function createAgentLogWriter(options: { dir: string; maxBytes?: number }): AgentLogWriter {
  const { dir } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const logPath = path.join(dir, "agent.log");
  const rotatedPath = `${logPath}.1`;

  function rotateIfNeeded(incomingBytes: number): void {
    let size: number;
    try {
      size = fs.statSync(logPath).size;
    } catch {
      return; // no current file — nothing to rotate
    }
    if (size + incomingBytes <= maxBytes) return;
    // rename over the previous rotation: atomic on POSIX, keeps exactly one
    // historical file alongside the live one.
    fs.renameSync(logPath, rotatedPath);
  }

  function writeRaw(line: string): void {
    const data = `${line}\n`;
    try {
      rotateIfNeeded(Buffer.byteLength(data));
      fs.appendFileSync(logPath, data);
    } catch {
      // The logs dir may have been wiped (logout teardown removes
      // ~/.inteligir wholesale). Recreate it and retry once; past that,
      // stderr is the fallback record.
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(logPath, data);
      } catch (err) {
        process.stderr.write(`[agent-log] write to ${logPath} failed: ${String(err)}\n`);
      }
    }
  }

  function append(level: ConsoleLevel, args: unknown[]): void {
    if (!shouldMirror(level, args)) return;
    writeRaw(`${new Date().toISOString()} ${LEVEL_LABEL[level]} ${formatArgs(args)}`);
  }

  return { logPath, append, writeRaw };
}

let patched = false;

/** Wire console.log/warn/error to also write to the agent log file. Idempotent
 * — safe to call more than once per process. */
export function initAgentLog(): void {
  if (patched) return;
  const writer = createAgentLogWriter({ dir: inteligirPath("logs") });
  writer.writeRaw(`\n--- ${new Date().toISOString()} session start (pid ${process.pid}) ---`);
  const { log, warn, error } = console;
  console.log = (...args: unknown[]) => {
    writer.append("info", args);
    log(...args);
  };
  console.warn = (...args: unknown[]) => {
    writer.append("warn", args);
    warn(...args);
  };
  console.error = (...args: unknown[]) => {
    writer.append("error", args);
    error(...args);
  };
  patched = true;
}
