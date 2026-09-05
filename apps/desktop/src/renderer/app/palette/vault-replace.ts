// One note at a time, each write carrying the hash of the bytes its rewrite was computed
// from. A mismatch is reported, never diff3-merged: the user asked for these exact
// replacements in these exact lines, and a merge would be a guess about a file that moved.

import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { replaceTextMatches, type TextMatchOptions } from "@repo/notes/knowledge/text-matches";
import { isDefinedError, refusalMessage, safe, type client } from "../api";

export interface ReplaceVaultApi {
  vault: Pick<(typeof client)["vault"], "read" | "write">;
}

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
  const read = await safe(api.vault.read({ path }));
  if (read.error !== null) {
    return { path, kind: "failed", message: refusalMessage(read.error, "could not read it") };
  }
  const content = read.data.content;
  const { text, count } = replaceTextMatches(
    content,
    request.needle,
    request.replacement,
    request.options,
  );
  if (count === 0) return { path, kind: "unchanged" };
  const expectedHash = await contentHashHex(content);
  const { error } = await safe(api.vault.write({ path, content: text, expectedHash }));
  if (error === null) return { path, kind: "replaced", count };
  if (isDefinedError(error) && error.code === "CAS_MISMATCH") return { path, kind: "changed" };
  return { path, kind: "failed", message: refusalMessage(error, "the write was refused") };
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
