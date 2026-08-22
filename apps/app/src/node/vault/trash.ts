// Trash over the vault service (Moss's shape): deleting a note MOVES it into
// the vault's own `Trash/` folder, keeping its relative path, its bytes and
// its comments sidecar; restore moves it back. The original path and the
// deletion time ride the note's OWN frontmatter (`trashed-from`/`trashed-at`)
// because frontmatter is the only property store — a second metadata file
// would be a second answer that can disagree with the first.
//
// Every operation composes the service's existing primitives, so each move
// announces itself, rides the repo lock, and names its paths for the commit
// scheduler like any other mutation. The stamp lands as a SEPARATE guarded
// write after the rename: a raced concurrent edit keeps its bytes and only
// the metadata is lost, which restore covers with the path-derived fallback.
//
// The stamp is a TEXTUAL splice, not a yaml re-serialize: two literal lines
// inserted before the closing fence, and the strip removes exactly those
// lines — so restore hands back the original bytes exactly. The CST editor
// would re-flow untouched yaml (a `[a]` flow-seq gains spaces), which turns
// "delete then restore" into a diff the user never wrote.

import { splitFrontmatter, type SplitDoc } from "@repo/notes/markdown/frontmatter";
import { z } from "zod";
import { isTrashedPath, VAULT_TRASH_DIR, VaultPathError } from "@repo/notes/knowledge/vault-path";
import type { VaultTrashEntry } from "@repo/server-contract/vault";
import { VaultServiceError, type VaultService } from "./vault-service";

export const TRASHED_FROM_KEY = "trashed-from";
export const TRASHED_AT_KEY = "trashed-at";

/** Moss keeps trashed notes for 30 days; so do we. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const COLLISION_ATTEMPTS = 1000;

/** JSON string quoting IS valid YAML double-quoted scalar quoting, so a path
 * holding `:`/`#`/quotes still parses back as the string it was. */
function yamlQuoted(value: string): string {
  return JSON.stringify(value);
}

const TRASH_LINE_RE = /^trashed-(?:from|at):.*\r?\n/;

// The stamp read back off disk is I/O: parsed here, once, into a plain
// non-empty string or nothing.
const stampSchema = z.string().trim().min(1);

function stampOf(properties: SplitDoc["properties"], key: string): string | null {
  const parsed = stampSchema.safeParse(properties[key]);
  return parsed.success ? parsed.data : null;
}

/** Insert the two stamp lines before the closing fence (minting a block when
 * the doc has none). Purely textual: every other byte stays exactly put. */
function stampTrashLines(content: string, from: string, atIso: string): string {
  const lines = `${TRASHED_FROM_KEY}: ${yamlQuoted(from)}\n${TRASHED_AT_KEY}: ${yamlQuoted(atIso)}\n`;
  const { body } = splitFrontmatter(content);
  if (body === content) {
    return `---\n${lines}---\n${content}`;
  }
  const header = content.slice(0, content.length - body.length);
  const closing = header.lastIndexOf("---");
  return header.slice(0, closing) + lines + header.slice(closing) + body;
}

/** Remove exactly the lines the stamp wrote; a block that held nothing else
 * disappears whole. Idempotent, and inert on a file with no stamp. */
function stripTrashLines(content: string): string {
  const { body } = splitFrontmatter(content);
  if (body === content) return content;
  const header = content.slice(0, content.length - body.length);
  const kept = header
    .split(/(?<=\n)/)
    .filter((line) => !TRASH_LINE_RE.test(line))
    .join("");
  const emptyBlock = /^---[ \t]*\r?\n---[ \t]*\r?\n?$/;
  if (emptyBlock.test(kept)) return body;
  return kept + body;
}

function sidecarOf(notePath: string): string {
  return `${notePath}.comments.json`;
}

function isNotePath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

/** `a/b.md` + 2 → `a/b 2.md`; suffix before the extension so the file stays
 * a note. */
function withSuffix(path: string, attempt: number): string {
  if (attempt === 0) return path;
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  return `${stem} ${attempt + 1}${ext}`;
}

async function freePath(service: VaultService, wanted: string): Promise<string> {
  for (let attempt = 0; attempt < COLLISION_ATTEMPTS; attempt++) {
    const candidate = withSuffix(wanted, attempt);
    if ((await service.statEntry(candidate)) === null) return candidate;
  }
  throw new VaultServiceError("conflict", `no free name near ${wanted}`);
}

/** Move `path`'s sidecar alongside its note's new name, if one exists. A
 * failed sidecar move must not fail the note's own move — the note is already
 * where the caller asked; the orphaned sidecar is inert and visible. */
async function moveSidecar(service: VaultService, from: string, to: string): Promise<void> {
  if ((await service.statEntry(sidecarOf(from))) !== "file") return;
  await service.rename(sidecarOf(from), sidecarOf(to)).catch(() => {});
}

export interface TrashMoveResult {
  path: string;
}

/** Move a note into `Trash/`, stamping where it came from and when. */
export async function trashNote(service: VaultService, path: string): Promise<TrashMoveResult> {
  if (isTrashedPath(path)) {
    throw new VaultPathError(`${path} is already in the trash`);
  }
  if (!isNotePath(path)) {
    throw new VaultPathError(`${path} is not a note; delete it instead`);
  }
  const { content } = await service.read(path);
  const target = await freePath(service, `${VAULT_TRASH_DIR}/${path}`);
  await service.rename(path, target);
  await moveSidecar(service, path, target);
  const stamped = stampTrashLines(content, path, new Date().toISOString());
  // Guarded: if something edited the file between the rename and here, the
  // edit wins and the stamp is skipped — restore falls back to the path.
  await service.writeIfUnchanged(target, content, stamped);
  return { path: target };
}

/** Where a trashed note goes back to: its stamp first, its Trash-relative
 * path when the stamp is missing or unreadable. */
function restoreTarget(trashPath: string, content: string): string {
  const from = stampOf(splitFrontmatter(content).properties, TRASHED_FROM_KEY);
  if (from !== null && !isTrashedPath(from)) {
    return from;
  }
  return trashPath.slice(`${VAULT_TRASH_DIR}/`.length);
}

/** Move a trashed note back to where it came from. */
export async function restoreNote(service: VaultService, path: string): Promise<TrashMoveResult> {
  if (!isTrashedPath(path) || path === VAULT_TRASH_DIR) {
    throw new VaultPathError(`${path} is not in the trash`);
  }
  const { content } = await service.read(path);
  const target = await freePath(service, restoreTarget(path, content));
  await service.rename(path, target);
  await moveSidecar(service, path, target);
  const stripped = stripTrashLines(content);
  if (stripped !== content) {
    await service.writeIfUnchanged(target, content, stripped);
  }
  return { path: target };
}

/** Delete a trashed note (and its sidecar) for real. */
export async function purgeTrashedNote(service: VaultService, path: string): Promise<void> {
  if (!isTrashedPath(path) || path === VAULT_TRASH_DIR) {
    throw new VaultPathError(`${path} is not in the trash`);
  }
  await service.remove(path);
  if ((await service.statEntry(sidecarOf(path))) === "file") {
    await service.remove(sidecarOf(path)).catch(() => {});
  }
}

/** Every note in the trash, newest first. Reads each note's head for its
 * stamp; a file that will not read (too large, raced away) is listed by path
 * alone rather than dropped — the panel must never hide what purge can see. */
export async function listTrash(service: VaultService): Promise<VaultTrashEntry[]> {
  const files = await service.listFilesUnder(VAULT_TRASH_DIR);
  const entries: VaultTrashEntry[] = [];
  for (const path of files) {
    if (!isNotePath(path)) continue;
    const content = await service
      .read(path)
      .then((r) => r.content)
      .catch(() => null);
    let trashedFrom: string | null = null;
    let trashedAt: string | null = null;
    if (content !== null) {
      const { properties } = splitFrontmatter(content);
      trashedFrom = stampOf(properties, TRASHED_FROM_KEY);
      trashedAt = stampOf(properties, TRASHED_AT_KEY);
    }
    entries.push({ path, trashedAt, trashedFrom });
  }
  entries.sort((a, b) => (b.trashedAt ?? "").localeCompare(a.trashedAt ?? ""));
  return entries;
}

/** Purge every trashed note older than the retention window. An entry with no
 * readable `trashed-at` never ages and is never auto-purged — a date we did
 * not write is a guess, and a guess deletes someone's file. */
export async function sweepExpiredTrash(
  service: VaultService,
  now: number = Date.now(),
  retentionMs: number = TRASH_RETENTION_MS,
): Promise<number> {
  const entries = await listTrash(service);
  let purged = 0;
  for (const entry of entries) {
    if (entry.trashedAt === null) continue;
    const at = Date.parse(entry.trashedAt);
    if (Number.isNaN(at) || now - at < retentionMs) continue;
    await purgeTrashedNote(service, entry.path).catch(() => {
      // A raced restore or hand-move is not a sweep failure; the next pass
      // sees the current tree.
    });
    purged += 1;
  }
  return purged;
}
