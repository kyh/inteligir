// Reading the vault's own git log — the per-note history surface.
//
// `git.ts` WRITES the commits; this is the only thing that reads them back.
// Both invocations run under that engine's repo lock, because a rebase in
// flight has HEAD detached at a replayed commit and would answer a different
// history for the same note.
//
// `--follow` is not a nicety here: the vault has a rename route doing byte
// surgery on links, so notes get renamed routinely, and without it a renamed
// note's history silently truncates at the rename — the worst failure for a
// surface whose whole promise is "nothing is lost". `diff.renames` is pinned
// on for the same reason: `--follow` is rename detection, and a user who
// turned that off globally would otherwise get the truncation with no sign.

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

/** How many tokens the format above contributes per commit. */
const LOG_HEADER_FIELDS = 5;

/** git's own object name, in either hash algorithm a repo can be initialized
 *  with — this reads whatever the user's `git init` produced. */
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/**
 * Frame `git log --follow -z --name-status --format=<LOG_FORMAT>`.
 *
 * Each commit is the five format fields, then — when the commit has a
 * name-status block — a status token and its one or two paths. git separates
 * the format output from that block with a NEWLINE, so the status token, and
 * only the status token, begins with one. POSITION is what decides here, not
 * a scan: a filename that itself begins with a newline is legal on POSIX and
 * would otherwise read as a status.
 *
 * `--follow` reports the path AT each commit, newest first, so a commit with
 * no block (history simplification keeping a merge) inherits the newer row's
 * path — which is the path the note carried until this commit changed it, and
 * the requested path for the first row.
 */
export function parseFollowLog(stdout: string, requestedPath: string): VaultRevision[] {
  const tokens = stdout.split("\0");
  const revisions: VaultRevision[] = [];
  let pathAtNewerRevision = requestedPath;
  let index = 0;
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

    let path = pathAtNewerRevision;
    let renamedFrom: string | undefined;
    const status = tokens[index];
    if (status !== undefined && status.startsWith("\n")) {
      const isRename = /^\n[RC]/u.test(status);
      const first = tokens[index + 1];
      const second = isRename ? tokens[index + 2] : undefined;
      index += isRename ? 3 : 2;
      if (isRename) {
        if (first !== undefined && second !== undefined) {
          renamedFrom = first;
          path = second;
        }
      } else if (first !== undefined) {
        path = first;
      }
    }
    pathAtNewerRevision = path;

    const revision: VaultRevision = {
      sha,
      authoredAt,
      authorName,
      authorEmail,
      subject,
      path,
    };
    // exactOptionalPropertyTypes: an absent rename must drop the member, not
    // carry an explicit undefined the strict schema refuses.
    revisions.push(renamedFrom === undefined ? revision : { ...revision, renamedFrom });
  }
  return revisions;
}

export interface NoteHistoryPage {
  skip: number;
  limit: number;
}

/** The note's own commits, newest first, following renames. A path git has
 *  never seen answers an empty page — a note created inside the auto-commit's
 *  quiet window has no revisions yet, and that is an ordinary state. */
export async function readNoteHistory(
  run: RunGitCommand,
  path: string,
  page: NoteHistoryPage,
): Promise<VaultRevision[]> {
  const { stdout } = await run([
    "-c",
    "diff.renames=true",
    "log",
    "--follow",
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
 *
 * Two invocations rather than one: the size is checked before the blob is
 * buffered, the same bound and the same refusal `VaultService.read` raises for
 * a file on disk. A `cat-file` that cannot name the object is the note not
 * existing at that revision; a size that reads but a blob that does not is the
 * path naming a directory there, which is the same answer.
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
  const bytes = Number.parseInt(sized.stdout.trim(), 10);
  if (Number.isFinite(bytes) && bytes > VAULT_MAX_CONTENT_LENGTH) {
    throw new VaultServiceError(
      "too_large",
      `${path} at ${sha} is ${String(bytes)} bytes; the read cap is ${String(VAULT_MAX_CONTENT_LENGTH)}`,
    );
  }
  const blob = await run(["cat-file", "blob", object]).catch(() => null);
  if (blob === null) {
    throw absent();
  }
  return blob.stdout;
}
