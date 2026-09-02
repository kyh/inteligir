import { VAULT_MAX_CONTENT_LENGTH, type VaultRevision } from "@repo/api/local/vault/vault-schema";
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

// a commit's name-status block holds one or more tuples: a path that was a file, a directory,
// then a file again reports `A path` and `D path/child` in one commit.
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
