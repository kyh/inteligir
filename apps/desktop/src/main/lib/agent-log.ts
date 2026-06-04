// Tee the noisy main-process console lines ([agent-event], [agent], [machine],
// [pi-driver]) to ~/.inteligir/logs/agent.log so agents can debug without
// needing the dev terminal open. Append-only, single file, session-marker
// between runs. Best-effort: write failures fall back to stderr only.

import fs from "node:fs";
import path from "node:path";

import { inteligirPath } from "@/main/lib/json-store";

const LOG_DIR = inteligirPath("logs");
const LOG_PATH = path.join(LOG_DIR, "agent.log");

// Prefixes we mirror to the file. Anything else stays console-only so we
// don't bloat the log with framework noise.
const MIRROR_PREFIXES = ["[agent-event]", "[agent]", "[machine]", "[pi-driver]"];

let stream: fs.WriteStream | null = null;
let patched = false;

function shouldMirror(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === "string" && MIRROR_PREFIXES.some((p) => first.startsWith(p));
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

function appendLine(level: string, args: unknown[]): void {
  if (!stream || !shouldMirror(args)) return;
  const ts = new Date().toISOString();
  stream.write(`${ts} ${level} ${formatArgs(args)}\n`);
}

/** Wire console.log/warn/error to also write to the agent log file. Idempotent
 * — safe to call more than once per process. */
export function initAgentLog(): void {
  if (patched) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    stream = fs.createWriteStream(LOG_PATH, { flags: "a" });
    stream.write(`\n--- ${new Date().toISOString()} session start (pid ${process.pid}) ---\n`);
  } catch (err) {
    process.stderr.write(`[agent-log] failed to open ${LOG_PATH}: ${String(err)}\n`);
    return;
  }
  const { log, warn, error } = console;
  console.log = (...args: unknown[]) => {
    appendLine("INFO ", args);
    log(...args);
  };
  console.warn = (...args: unknown[]) => {
    appendLine("WARN ", args);
    warn(...args);
  };
  console.error = (...args: unknown[]) => {
    appendLine("ERROR", args);
    error(...args);
  };
  patched = true;
}
