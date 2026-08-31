// Reading the vault's own git log — the per-note history surface.
//
// `--follow` is not a nicety: the vault renames notes routinely (the rename
// route does byte surgery on links), and without it a renamed note's history
// truncates silently at the rename. Four invocation flags exist to make the
// answer depend on the repo rather than on the user's git config, and each is
// load-bearing:
//
// - `--literal-pathspecs`, because a pathspec is a GLOB. A note called
//   `[a].md` otherwise reports `a.md`'s history, and one called `*.md`
//   reports the whole vault's — with revisions whose bytes belong to another
//   note, which a restore would then write into this one.
// - `-c diff.renames=true`, because `--follow` IS rename detection, and a
//   user who turned it off globally would get the truncation with no sign.
// - `--root`, because `log.showRoot=false` hides the commit that created a
//   note in the vault's first commit — which is where the welcome seed lives.
// - `--no-show-signature`, because `log.showSignature=true` prints gpg's
//   verification lines ahead of the format output, and this parse frames on
//   position.

import { VAULT_MAX_CONTENT_LENGTH, type VaultRevision } from "@repo/api/local/vault/vault-schema";
import { VaultServiceError } from "./vault-service";

/** One git invocation, already bound to the repo and its environment. */
export type RunGitCommand = (args: readonly string[]) => Promise<{ stdout: string }>;

/**
 * NUL-separated fields, never newline-separated lines: git C-quotes any path
 * holding a space or a non-ASCII byte, and `-z` is what turns that off — the
 * same doctrine `parsePorcelain` states, for the same reason.
 */
const LOG_FORMAT = "%H%x00%aI%x00%an%x00%ae%x00%s";

const LOG_HEADER_FIELDS = LOG_FORMAT.split("%x00").length;

/** git's own object name, in either hash algorithm a repo can be initialized
 *  with — this reads whatever the user's `git init` produced. */
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** A name-status column with the similarity score a rename or copy carries.
 *  git separates the format output from the block with a newline, so the
 *  block's FIRST status is the only one that arrives with one attached. */
const STATUS_TOKEN = /^\n?([ACDMRTUXB])\d*$/u;

interface StatusTuple {
  letter: string;
  path: string;
  origin: string | null;
}

/**
 * Frame `git log --follow -z --name-status --format=<LOG_FORMAT>`.
 *
 * Each commit is the five format fields, then a name-status block of one or
 * MORE tuples — one is not enough. A path that was a file, became a directory
 * and became a file again reports `A <path>` and `D <path>/child` in the same
 * commit, and consuming only the first leaves a status token where the next
 * commit's object name is expected, which drops every older revision.
 *
 * The note's path at a commit is the last tuple that left CONTENT there. A
 * commit whose every tuple is a deletion left none, so it is not a revision
 * this surface can answer, and it is dropped rather than listed unreadable.
 *
 * `--follow` walks newest first and reports the path AT each commit, so a
 * commit with no block at all (history simplification keeping a merge)
 * inherits the newer row's path — the requested path for the first row.
 */
export function parseFollowLog(stdout: string, requestedPath: string): VaultRevision[] {
  const tokens = stdout.split("\0");
  const revisions: VaultRevision[] = [];
  let pathAtNewerRevision = requestedPath;
  let index = 0;

  const readTuple = (): StatusTuple | null => {
    const match = STATUS_TOKEN.exec(tokens[index] ?? "");
    if (match === null) {
      return null;
    }
    const letter = match[1] ?? "";
    const isPair = letter === "R" || letter === "C";
    const first = tokens[index + 1] ?? "";
    const second = isPair ? (tokens[index + 2] ?? "") : "";
    index += isPair ? 3 : 2;
    return isPair ? { letter, path: second, origin: first } : { letter, path: first, origin: null };
  };

  while (index < tokens.length) {
    const sha = tokens[index];
    if (sha === undefined || !OBJECT_NAME.test(sha)) {
      // The trailing empty token — and the one shape a drifted git would take.
      // Stopping beats mis-framing every record after it.
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
      // Every tuple was a deletion: the note had no bytes at this commit, so
      // it is not a revision this surface can answer.
      pathAtNewerRevision = deleted.path;
      continue;
    }
    // No block at all is the merge history simplification keeps — it inherits.
    const path = content?.path ?? pathAtNewerRevision;
    pathAtNewerRevision = path;

    const revision: VaultRevision = { sha, authoredAt, authorName, authorEmail, subject, path };
    // exactOptionalPropertyTypes: an absent rename must drop the member, not
    // carry an explicit undefined the strict schema refuses.
    const origin = content?.origin ?? null;
    revisions.push(origin === null ? revision : { ...revision, renamedFrom: origin });
  }
  return revisions;
}

export interface NoteHistoryPage {
  skip: number;
  limit: number;
}

/** A path git has never seen answers an empty page — a note created inside the
 *  auto-commit's quiet window has no revisions yet, and that is an ordinary
 *  state rather than a refusal. */
export async function readNoteHistory(
  run: RunGitCommand,
  path: string,
  page: NoteHistoryPage,
): Promise<VaultRevision[]> {
  const { stdout } = await run([
    "--literal-pathspecs",
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

/**
 * The bytes the note held at one revision, read at THAT revision's own path.
 * The size is checked before the blob is buffered — the same bound, and the
 * same two refusals, `VaultService.read` raises for a file on disk.
 */
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
  // A size that reads but a blob that does not is the path naming a folder at
  // that revision, which is the same answer as the note not being there.
  const blob = await run(["cat-file", "blob", object]).catch(() => null);
  if (blob === null) {
    throw absent();
  }
  return blob.stdout;
}
