// the stamp is a textual splice, not a yaml re-serialize: the cst editor re-flows untouched
// yaml (a `[a]` flow-seq gains spaces), turning delete-then-restore into a diff the user
// never wrote.

import { splitFrontmatter, type SplitDoc } from "@repo/notes/markdown/frontmatter";
import { z } from "zod";
import { commentsSidecarPath } from "@repo/notes/comments/sidecar-schema";
import { isNotePath } from "@repo/notes/knowledge/doc-file";
import { isTrashedPath, VAULT_TRASH_DIR, VaultPathError } from "@repo/notes/knowledge/vault-path";
import type { VaultTrashEntry } from "@repo/api/local/vault/vault-schema";
import { VaultServiceError, type VaultService } from "./vault-service";

const TRASHED_FROM_KEY = "trashed-from";
const TRASHED_AT_KEY = "trashed-at";

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const COLLISION_ATTEMPTS = 1000;

// json string quoting is valid yaml double-quoted scalar quoting.
function yamlQuoted(value: string): string {
  return JSON.stringify(value);
}

const TRASH_LINE_RE = /^trashed-(?:from|at):.*\r?\n/;

const stampSchema = z.string().trim().min(1);

function stampOf(properties: SplitDoc["properties"], key: string): string | null {
  const parsed = stampSchema.safeParse(properties[key]);
  return parsed.success ? parsed.data : null;
}

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

// a failed sidecar move must not fail the note's move: the note is already moved, the orphan is inert.
async function moveSidecar(service: VaultService, from: string, to: string): Promise<void> {
  if ((await service.statEntry(commentsSidecarPath(from))) !== "file") return;
  await service.rename(commentsSidecarPath(from), commentsSidecarPath(to)).catch(() => {});
}

export interface TrashMoveResult {
  path: string;
}

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
  // an edit that raced the rename wins and the stamp is skipped; restore falls back to the path.
  await service.writeIfUnchanged(target, content, stamped);
  return { path: target };
}

function restoreTarget(trashPath: string, content: string): string {
  const from = stampOf(splitFrontmatter(content).properties, TRASHED_FROM_KEY);
  if (from !== null && !isTrashedPath(from)) {
    return from;
  }
  return trashPath.slice(`${VAULT_TRASH_DIR}/`.length);
}

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

export async function purgeTrashedNote(service: VaultService, path: string): Promise<void> {
  if (!isTrashedPath(path) || path === VAULT_TRASH_DIR) {
    throw new VaultPathError(`${path} is not in the trash`);
  }
  await service.remove(path);
  if ((await service.statEntry(commentsSidecarPath(path))) === "file") {
    await service.remove(commentsSidecarPath(path)).catch(() => {});
  }
}

// an unreadable file is listed by path rather than dropped: the panel must not hide what purge can see.
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

// no readable trashed-at never ages: a guessed date deletes someone's file.
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
    const removed = await purgeTrashedNote(service, entry.path).then(
      () => true,
      // a raced restore or hand-move is not a sweep failure, but nothing was purged.
      () => false,
    );
    if (removed) {
      purged += 1;
    }
  }
  return purged;
}
