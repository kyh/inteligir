import {
  VAULT_DELETED_MAX_ENTRIES,
  VAULT_MAX_CONTENT_LENGTH,
} from "@repo/api/local/vault/vault-schema";
import type { VaultDeletedEntry, VaultRevision } from "@repo/api/local/vault/vault-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { ENGINE_IDENTITY } from "./git-run";
import type { RunGitCommand } from "./git-run";
import { AGENT_COMMIT_AUTHOR, parseAgentCommitTrailers, threadTrailer } from "./turn-trailers";
import type { AgentCommitTrailers } from "./turn-trailers";
import { VaultServiceError } from "./vault-service";

// nul-separated: git c-quotes paths holding a space or a non-ascii byte in the line format.
const LOG_FORMAT = "%H%x00%aI%x00%an%x00%ae%x00%s";

const LOG_HEADER_FIELDS = LOG_FORMAT.split("%x00").length;

// sha1 or sha256 repos.
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

// the optional newline: git separates the format output from the name-status block with one.
const STATUS_TOKEN = /^\n?(?<letter>[ACDMRTUXB])\d*$/u;

interface StatusTuple {
  letter: string;
  path: string;
  origin: string | null;
}

// null when the token at `index` is not a status: the block has ended.
const readStatusTuple = (
  tokens: readonly string[],
  index: number,
): { tuple: StatusTuple; next: number } | null => {
  const match = STATUS_TOKEN.exec(tokens[index] ?? "");
  if (match === null) {
    return null;
  }
  const letter = match.groups?.letter ?? "";
  const isPair = letter === "R" || letter === "C";
  const first = tokens[index + 1] ?? "";
  const second = isPair ? (tokens[index + 2] ?? "") : "";
  return {
    next: index + (isPair ? 3 : 2),
    tuple: isPair ? { letter, origin: first, path: second } : { letter, origin: null, path: first },
  };
};

const authorKindOf = (authorEmail: string): VaultRevision["authorKind"] => {
  if (authorEmail === ENGINE_IDENTITY.email) {
    return "app";
  }
  return authorEmail === AGENT_COMMIT_AUTHOR.email ? "agent" : "external";
};

// a commit's name-status block holds one or more tuples: a path that was a file, a directory,
// then a file again reports `A path` and `D path/child` in one commit.
export const parseFollowLog = (stdout: string, requestedPath: string): VaultRevision[] => {
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

    const revision: VaultRevision = {
      authorEmail,
      authorKind: authorKindOf(authorEmail),
      authorName,
      authoredAt,
      path,
      sha,
      subject,
    };
    // exactOptionalPropertyTypes: an absent rename must drop the member, not carry undefined.
    const origin = content?.origin ?? null;
    revisions.push(origin === null ? revision : { ...revision, renamedFrom: origin });
  }
  return revisions;
};

export interface NoteHistoryPage {
  skip: number;
  limit: number;
}

// a path git has never seen answers an empty page, not a refusal.
export const readNoteHistory = async (
  run: RunGitCommand,
  path: string,
  page: NoteHistoryPage,
): Promise<VaultRevision[]> => {
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
};

export const readNoteRevision = async (
  run: RunGitCommand,
  path: string,
  sha: string,
): Promise<string> => {
  const object = `${sha}:${path}`;
  const absent = (): VaultServiceError =>
    new VaultServiceError("not_found", `${path} does not exist at ${sha}`);

  const sized = await run(["cat-file", "-s", object]).catch(() => null);
  if (sized === null) {
    throw absent();
  }
  if (Math.trunc(Number(sized.stdout.trim())) > VAULT_MAX_CONTENT_LENGTH) {
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
};

const DELETION_LOG_FORMAT = "%H%x00%P%x00%aI";

const DELETION_HEADER_FIELDS = DELETION_LOG_FORMAT.split("%x00").length;

export interface DeletionRecord {
  // the deleting commit's first parent: the tree that still holds the bytes.
  parent: string;
  deletedAt: string;
  paths: string[];
}

export const parseDeletionLog = (stdout: string): DeletionRecord[] => {
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
      records.push({ deletedAt, parent, paths });
    }
  }
  return records;
};

// -c diff.renames=true: a rename is a note that still exists, and a user's global config may
// turn detection off and report it as a deletion plus an addition. the walk starts at a named
// head rather than HEAD, so its records are a function of that sha; "--" keeps a vault file
// named like it from reading as a path.
const readDeletionLog = async (run: RunGitCommand, head: string): Promise<DeletionRecord[]> => {
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
    head,
    "--",
  ]);
  return parseDeletionLog(stdout);
};

type DeletionLog = (head: string) => Promise<readonly DeletionRecord[]>;

// the walk grows with the vault's age, and every files-changed frame re-asks while the Deleted
// view is open, mostly at a head that has not moved. the slot holds the promise so a burst of
// reads shares one git child; a failed walk is dropped so the next read retries it.
export const cachedDeletionLog = (run: RunGitCommand): DeletionLog => {
  let slot: { head: string; records: Promise<DeletionRecord[]> } | null = null;
  return async (head) => {
    if (slot?.head === head) {
      return await slot.records;
    }
    const walk = { head, records: readDeletionLog(run, head) };
    slot = walk;
    try {
      return await walk.records;
    } catch (error) {
      if (slot === walk) {
        slot = null;
      }
      throw error;
    }
  };
};

// docs no longer on disk, newest deletion first, one entry per path. two sources: the log's
// deletions, and `ls-files --deleted` for the ones the session-shaped auto-commit has not
// flushed, whose bytes HEAD still holds. a path back on disk is left out whichever source
// named it — the entry would restore over the user's own re-creation.
export const readDeletedNotes = async (
  run: RunGitCommand,
  deletionLog: DeletionLog,
  exists: (path: string) => boolean,
): Promise<VaultDeletedEntry[]> => {
  const { stdout: headStdout } = await run(["rev-parse", "HEAD"]);
  const head = headStdout.trim();
  const { stdout: deletedStdout } = await run(["ls-files", "-z", "--deleted"]);
  const unflushed = deletedStdout.split("\0").filter((path) => path.length > 0);
  const records = await deletionLog(head);

  const readAt = new Date().toISOString();
  const candidates: VaultDeletedEntry[] = [
    ...unflushed.map((path) => ({ deletedAt: readAt, path, sha: head })),
    ...records.flatMap((record) =>
      record.paths.map((path) => ({ deletedAt: record.deletedAt, path, sha: record.parent })),
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
};

const TURN_LOG_FORMAT = "%H%x00%P%x00%B";

const TURN_HEADER_FIELDS = TURN_LOG_FORMAT.split("%x00").length;

type TurnChangeStatus = "A" | "M" | "D";

// --no-renames: a moved note is the path it left and the path it made. a type change (a file
// turned symlink) is still an edit of that path.
const TURN_CHANGE_STATUS = new Map<string, TurnChangeStatus>([
  ["A", "A"],
  ["D", "D"],
  ["M", "M"],
  ["T", "M"],
]);

interface TurnFileChange {
  status: TurnChangeStatus;
  path: string;
}

export interface TurnCommit {
  sha: string;
  // the tree just before the commit, which holds the bytes the commit replaced.
  parent: string;
  trailers: AgentCommitTrailers;
  changes: TurnFileChange[];
}

const parseTurnLog = (stdout: string, threadId: string): TurnCommit[] => {
  const tokens = stdout.split("\0");
  const commits: TurnCommit[] = [];
  let index = 0;
  while (index < tokens.length) {
    const sha = tokens[index];
    if (sha === undefined || !OBJECT_NAME.test(sha)) {
      break;
    }
    const [parent] = (tokens[index + 1] ?? "").split(" ");
    const trailers = parseAgentCommitTrailers(tokens[index + 2] ?? "");
    index += TURN_HEADER_FIELDS;

    const changes: TurnFileChange[] = [];
    for (
      let read = readStatusTuple(tokens, index);
      read !== null;
      read = readStatusTuple(tokens, index)
    ) {
      index = read.next;
      const status = TURN_CHANGE_STATUS.get(read.tuple.letter);
      if (status !== undefined) {
        changes.push({ path: read.tuple.path, status });
      }
    }
    // the grep matches a substring, so `thr_a` also finds the commits of `thr_ab`.
    if (trailers?.threadId === threadId && parent !== undefined && OBJECT_NAME.test(parent)) {
      commits.push({ changes, parent, sha, trailers });
    }
  }
  return commits;
};

interface TurnLogQuery {
  threadId: string;
  // epoch ms; a commit its device committed earlier is not read.
  since: number;
}

// oldest first. --fixed-strings: the id is data, and a user's grep.patternType would otherwise
// decide what its characters mean. --since reads the committer date, which a rebase moves
// forward and never back, so a turn replayed onto another device's push is still found.
export const readTurnCommits = async (
  run: RunGitCommand,
  query: TurnLogQuery,
): Promise<TurnCommit[]> => {
  const { stdout } = await run([
    "log",
    "--no-merges",
    "--no-renames",
    "--no-show-signature",
    "--reverse",
    "-z",
    "--name-status",
    `--format=${TURN_LOG_FORMAT}`,
    "--fixed-strings",
    `--grep=${threadTrailer(query.threadId)}`,
    `--since=@${String(Math.floor(query.since / 1000))} +0000`,
  ]);
  return parseTurnLog(stdout, query.threadId);
};
