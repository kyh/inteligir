import {
  VAULT_DELETED_MAX_ENTRIES,
  VAULT_MAX_CONTENT_LENGTH,
  type VaultDeletedEntry,
  type VaultRevision,
} from "@repo/api/local/vault/vault-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { RunGitCommand } from "./git-run";
import { VaultServiceError } from "./vault-service";

// nul-separated: git c-quotes paths holding a space or a non-ascii byte in the line format.
const LOG_FORMAT = "%H%x00%aI%x00%an%x00%ae%x00%s";

const LOG_HEADER_FIELDS = LOG_FORMAT.split("%x00").length;

// sha1 or sha256 repos.
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

// the optional newline: git separates the format output from the name-status block with one.
const STATUS_TOKEN = /^\n?([ACDMRTUXB])\d*$/u;

interface StatusTuple {
  letter: string;
  path: string;
  origin: string | null;
}

// null when the token at `index` is not a status: the block has ended.
function readStatusTuple(
  tokens: readonly string[],
  index: number,
): { tuple: StatusTuple; next: number } | null {
  const match = STATUS_TOKEN.exec(tokens[index] ?? "");
  if (match === null) {
    return null;
  }
  const letter = match[1] ?? "";
  const isPair = letter === "R" || letter === "C";
  const first = tokens[index + 1] ?? "";
  const second = isPair ? (tokens[index + 2] ?? "") : "";
  return {
    tuple: isPair ? { letter, path: second, origin: first } : { letter, path: first, origin: null },
    next: index + (isPair ? 3 : 2),
  };
}

// a commit's name-status block holds one or more tuples: a path that was a file, a directory,
// then a file again reports `A path` and `D path/child` in one commit.
export function parseFollowLog(stdout: string, requestedPath: string): VaultRevision[] {
  const tokens = stdout.split("\0");
  const revisions: VaultRevision[] = [];
  let pathAtNewerRevision = requestedPath;
  let index = 0;

  const readTuple = (): StatusTuple | null => {
    const read = readStatusTuple(tokens, index);
    if (read === null) {
      return null;
    }
    index = read.next;
    return read.tuple;
  };

  while (index < tokens.length) {
    const sha = tokens[index];
    if (sha === undefined || !OBJECT_NAME.test(sha)) {
      // the trailing empty token; stopping beats mis-framing everything after a drifted git.
      break;
    }
    const authoredAt = tokens[index + 1] ?? "";
    const authorName = tokens[index + 2] ?? "";
    const authorEmail = tokens[index + 3] ?? "";
    const subject = tokens[index + 4] ?? "";
    index += LOG_HEADER_FIELDS;

    let content: StatusTuple | null = null;
    let deleted: StatusTuple | null = null;
    for (let tuple = readTuple(); tuple !== null; tuple = readTuple()) {
      if (tuple.letter === "D") {
        deleted = tuple;
      } else {
        content = tuple;
      }
    }
    if (content === null && deleted !== null) {
      // every tuple a deletion: no bytes at this commit.
      pathAtNewerRevision = deleted.path;
      continue;
    }
    // no block (history simplification kept a merge): inherit the newer path.
    const path = content?.path ?? pathAtNewerRevision;
    pathAtNewerRevision = path;

    const revision: VaultRevision = { sha, authoredAt, authorName, authorEmail, subject, path };
    // exactOptionalPropertyTypes: an absent rename must drop the member, not carry undefined.
    const origin = content?.origin ?? null;
    revisions.push(origin === null ? revision : { ...revision, renamedFrom: origin });
  }
  return revisions;
}

export interface NoteHistoryPage {
  skip: number;
  limit: number;
}

// a path git has never seen answers an empty page, not a refusal.
export async function readNoteHistory(
  run: RunGitCommand,
  path: string,
  page: NoteHistoryPage,
): Promise<VaultRevision[]> {
  // --follow: the vault renames notes routinely, and without it history truncates at the rename.
  // -c diff.renames=true: --follow is rename detection, which a user's global config may turn off.
  // --root: log.showRoot=false would hide the vault's first commit, where the seed lives.
  // --no-show-signature: log.showSignature=true prints gpg lines ahead of the format output.
  const { stdout } = await run([
    "-c",
    "diff.renames=true",
    "log",
    "--follow",
    "--root",
    "--no-show-signature",
    "-z",
    "--name-status",
    `--format=${LOG_FORMAT}`,
    `--skip=${String(page.skip)}`,
    "-n",
    String(page.limit),
    "--",
    path,
  ]);
  return parseFollowLog(stdout, path);
}

export async function readNoteRevision(
  run: RunGitCommand,
  path: string,
  sha: string,
): Promise<string> {
  const object = `${sha}:${path}`;
  const absent = (): VaultServiceError =>
    new VaultServiceError("not_found", `${path} does not exist at ${sha}`);

  const sized = await run(["cat-file", "-s", object]).catch(() => null);
  if (sized === null) {
    throw absent();
  }
  if (Number.parseInt(sized.stdout.trim(), 10) > VAULT_MAX_CONTENT_LENGTH) {
    throw new VaultServiceError(
      "too_large",
      `${path} at ${sha} is over the ${String(VAULT_MAX_CONTENT_LENGTH)}-byte read cap`,
    );
  }
  // a size that reads but no blob: the path names a folder at that revision.
  const blob = await run(["cat-file", "blob", object]).catch(() => null);
  if (blob === null) {
    throw absent();
  }
  return blob.stdout;
}

const DELETION_LOG_FORMAT = "%H%x00%P%x00%aI";

const DELETION_HEADER_FIELDS = DELETION_LOG_FORMAT.split("%x00").length;

export interface DeletionRecord {
  // the deleting commit's first parent: the tree that still holds the bytes.
  parent: string;
  deletedAt: string;
  paths: string[];
}

export function parseDeletionLog(stdout: string): DeletionRecord[] {
  const tokens = stdout.split("\0");
  const records: DeletionRecord[] = [];
  let index = 0;
  while (index < tokens.length) {
    const sha = tokens[index];
    if (sha === undefined || !OBJECT_NAME.test(sha)) {
      break;
    }
    // `%P` is space-separated; --no-merges leaves one, but the frame is read the same either way.
    const [parent] = (tokens[index + 1] ?? "").split(" ");
    const deletedAt = tokens[index + 2] ?? "";
    index += DELETION_HEADER_FIELDS;

    const paths: string[] = [];
    for (
      let read = readStatusTuple(tokens, index);
      read !== null;
      read = readStatusTuple(tokens, index)
    ) {
      index = read.next;
      if (read.tuple.letter === "D") {
        paths.push(read.tuple.path);
      }
    }
    if (parent !== undefined && OBJECT_NAME.test(parent)) {
      records.push({ parent, deletedAt, paths });
    }
  }
  return records;
}

// docs no longer on disk, newest deletion first, one entry per path. two sources: the log's
// deletions, and `ls-files --deleted` for the ones the session-shaped auto-commit has not
// flushed, whose bytes HEAD still holds. a path back on disk is left out whichever source
// named it — the entry would restore over the user's own re-creation.
export async function readDeletedNotes(
  run: RunGitCommand,
  exists: (path: string) => boolean,
): Promise<VaultDeletedEntry[]> {
  const head = (await run(["rev-parse", "HEAD"])).stdout.trim();
  const unflushed = (await run(["ls-files", "-z", "--deleted"])).stdout
    .split("\0")
    .filter((path) => path.length > 0);
  // -c diff.renames=true: a rename is a note that still exists, and a user's global config may
  // turn detection off and report it as a deletion plus an addition.
  const { stdout } = await run([
    "-c",
    "diff.renames=true",
    "log",
    "--no-merges",
    "--no-show-signature",
    "--diff-filter=D",
    "-z",
    "--name-status",
    `--format=${DELETION_LOG_FORMAT}`,
    "-n",
    String(VAULT_DELETED_MAX_ENTRIES),
  ]);

  const readAt = new Date().toISOString();
  const candidates: VaultDeletedEntry[] = [
    ...unflushed.map((path) => ({ path, deletedAt: readAt, sha: head })),
    ...parseDeletionLog(stdout).flatMap((record) =>
      record.paths.map((path) => ({ path, deletedAt: record.deletedAt, sha: record.parent })),
    ),
  ];
  const seen = new Set<string>();
  const entries: VaultDeletedEntry[] = [];
  for (const candidate of candidates) {
    if (entries.length === VAULT_DELETED_MAX_ENTRIES) {
      break;
    }
    if (seen.has(candidate.path)) {
      continue;
    }
    seen.add(candidate.path);
    if (isDocPath(candidate.path) && !exists(candidate.path)) {
      entries.push(candidate);
    }
  }
  return entries;
}
