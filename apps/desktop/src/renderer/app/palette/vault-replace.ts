// One note at a time, each write carrying the hash of the bytes its rewrite was computed
// from. A mismatch is reported, never diff3-merged: the user asked for these exact
// replacements in these exact lines, and a merge would be a guess about a file that moved.

import { replaceTextMatches, type TextMatchOptions } from "@repo/notes/knowledge/text-matches";
import { rewriteNote, type RewriteNoteApi } from "../note/rewrite-note";

export type ReplaceVaultApi = RewriteNoteApi;

export interface VaultReplaceRequest {
  needle: string;
  replacement: string;
  options: TextMatchOptions;
  paths: readonly string[];
}

// what a running replace reports and listens to: a count after every file, and a signal
// honoured between files, never inside one
export interface ReplaceProgressPort {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export type VaultReplaceOutcome =
  | { path: string; kind: "replaced"; count: number }
  | { path: string; kind: "unchanged" }
  // the file moved under the read; nothing was written
  | { path: string; kind: "changed" }
  | { path: string; kind: "failed"; message: string };

async function replaceInNote(
  api: ReplaceVaultApi,
  path: string,
  request: VaultReplaceRequest,
): Promise<VaultReplaceOutcome> {
  const outcome = await rewriteNote(api, path, (content) => {
    const { text, count } = replaceTextMatches(
      content,
      request.needle,
      request.replacement,
      request.options,
    );
    return { content: text, result: count };
  });
  switch (outcome.kind) {
    case "written":
      return { path, kind: "replaced", count: outcome.result };
    case "unchanged":
      return { path, kind: "unchanged" };
    case "changed":
      return { path, kind: "changed" };
    case "failed":
      return { path, kind: "failed", message: outcome.message };
  }
}

// the outcomes stop at the cancel: their count against `request.paths` is what was left alone
export async function replaceInVault(
  api: ReplaceVaultApi,
  request: VaultReplaceRequest,
  port: ReplaceProgressPort = {},
): Promise<VaultReplaceOutcome[]> {
  const outcomes: VaultReplaceOutcome[] = [];
  for (const path of request.paths) {
    if (port.signal?.aborted === true) break;
    outcomes.push(await replaceInNote(api, path, request));
    port.onProgress?.(outcomes.length, request.paths.length);
  }
  return outcomes;
}

export interface ReplaceSummary {
  tone: "success" | "warning" | "error";
  message: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// `untouched` is how many notes a cancel left unvisited; zero for a run that finished
export function summarizeReplace(
  outcomes: readonly VaultReplaceOutcome[],
  untouched = 0,
): ReplaceSummary {
  const replaced = outcomes.filter((outcome) => outcome.kind === "replaced");
  const matches = replaced.reduce((sum, outcome) => sum + outcome.count, 0);
  const changed = outcomes.filter((outcome) => outcome.kind === "changed").map((o) => o.path);
  const failed = outcomes.filter((outcome) => outcome.kind === "failed");
  const parts = [
    ...(untouched > 0
      ? [
          `Stopped after ${plural(outcomes.length, "note", "notes")}, ${plural(untouched, "note", "notes")} left untouched`,
        ]
      : []),
    matches === 0
      ? "Nothing replaced"
      : `Replaced ${plural(matches, "match", "matches")} in ${plural(replaced.length, "note", "notes")}`,
    ...(changed.length > 0 ? [`skipped, changed since read: ${changed.join(", ")}`] : []),
    ...(failed.length > 0
      ? [`refused: ${failed.map((outcome) => `${outcome.path} (${outcome.message})`).join(", ")}`]
      : []),
  ];
  return {
    tone: failed.length > 0 ? "error" : changed.length > 0 ? "warning" : "success",
    message: `${parts.join(". ")}.`,
  };
}
