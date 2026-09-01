// One responsibility: RUNNING the system git binary (execFile, no shell) —
// the argv builder every invocation passes through, the env that keeps git
// from ever asking this process a question, the identity commits run under,
// and the classifiers that read an invocation's stderr back into a typed
// answer. Nothing here knows about the vault's repo, its lock or its state.

import { execFile } from "node:child_process";

const LOCAL_GIT_TIMEOUT_MS = 30_000;
export const NETWORK_GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/** Commits the engine makes on its own carry this identity; an agent-attributed
 *  commit (#549) overrides the AUTHOR half only, so the committer always says
 *  which machine wrote it. */
const ENGINE_IDENTITY = { name: "inteligir", email: "vault@inteligir.local" };

/** The author seam: agent-attributed commits (#549) pass their own identity. */
export interface CommitAuthor {
  name: string;
  email: string;
}

export function identityEnv(author?: CommitAuthor) {
  return {
    GIT_AUTHOR_NAME: author?.name ?? ENGINE_IDENTITY.name,
    GIT_AUTHOR_EMAIL: author?.email ?? ENGINE_IDENTITY.email,
    GIT_COMMITTER_NAME: ENGINE_IDENTITY.name,
    GIT_COMMITTER_EMAIL: ENGINE_IDENTITY.email,
  };
}

export class GitError extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.stderr = stderr;
  }
}

export interface RunGitOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

/** One git invocation, already bound to the repo and its environment. */
export type RunGitCommand = (args: readonly string[]) => Promise<{ stdout: string }>;

/** The full invocation surface, for a caller that picks its own cwd and
 *  options per call — the bootstrap's injectable port. */
export type RunGit = typeof runGit;

/**
 * git must NEVER ask this process a question. Nothing here has a terminal to
 * answer on, and every invocation runs under the repo lock — so a credential
 * prompt on an unreachable or auth-requiring remote does not fail, it BLOCKS,
 * holding the lock (and with it every vault write) until the call's timeout.
 *
 * `GIT_TERMINAL_PROMPT=0` covers git's own prompting. ssh does its own, which
 * only `BatchMode=yes` refuses — so an ssh remote gets it too, but only when
 * the environment carries no `GIT_SSH_COMMAND` of its own: a caller who set
 * one has chosen how ssh runs, and overriding it would break the setups that
 * exist to make these fetches work.
 */
function nonInteractiveGitEnv(env: NodeJS.ProcessEnv) {
  if (env.GIT_SSH_COMMAND === undefined) {
    return { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
  }
  return { GIT_TERMINAL_PROMPT: "0" };
}

/**
 * THE argv builder — every invocation passes through here, so this is where
 * `--literal-pathspecs` lives and the one place it can be forgotten. A
 * pathspec is a GLOB: `[a].md` names `a.md` too, and a commit scoped to one
 * note would stage its neighbour's edits under the wrong revision. Every path
 * this module passes is a filesystem name, never a pattern (git-history.ts's
 * header carries the full case for the read side).
 */
export function runGit(
  cwd: string,
  gitArgs: readonly string[],
  options: RunGitOptions = {},
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["--literal-pathspecs", ...gitArgs],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        timeout: options.timeoutMs ?? LOCAL_GIT_TIMEOUT_MS,
        env: { ...process.env, ...nonInteractiveGitEnv(process.env), ...options.env },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new GitError(`git ${gitArgs[0] ?? ""} failed: ${error.message}`, stderr));
          return;
        }
        resolve({ stdout });
      },
    );
    // execFile hands the child a stdin PIPE nobody ever writes to. No command
    // this engine runs reads stdin, so closing it turns anything that asks
    // anyway into an immediate EOF rather than a wait on the timeout.
    child.stdin?.end();
  });
}

/**
 * Strip userinfo before a remote URL reaches a log line or a status response:
 * an https remote is where a token rides (https://user:ghp_…@github.com/…).
 * Non-URL forms (scp-like git@host:path) pass through — that syntax has no
 * password slot.
 */
export function redactRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username === "" && parsed.password === "") {
      return url;
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Whether a failed network invocation was the remote REFUSING the credential,
 * as opposed to being unreachable. Three spellings, because git's own varies:
 * an explicit 401/403 from the HTTP layer, "Authentication failed", and —
 * the one this engine's non-interactive env actually produces — "could not
 * read Username … terminal prompts disabled", which is git answering a 401
 * challenge with a prompt this process forbids.
 */
export function isAuthRefusal(cause: unknown): boolean {
  if (!(cause instanceof GitError)) {
    return false;
  }
  return /authentication failed|returned error: 40[13]|could not read username/i.test(cause.stderr);
}

/** The remote itself is absent — the hosted repo before its first push
 *  (HTTP 404), or a path that names no repository. Distinct from
 *  unreachable/refused because only THIS class may fall through to the
 *  welcome seed: seeding beside a populated-but-unreachable remote plants a
 *  history the eventual first sync has to rebase through. */
export function isMissingRemoteRepo(cause: unknown): boolean {
  if (!(cause instanceof GitError)) {
    return false;
  }
  return /repository .+ (not found|does not exist)|returned error: 404|does not appear to be a git repository/i.test(
    cause.stderr,
  );
}

/**
 * A remote with nothing to fetch YET: the branch is missing ("couldn't find
 * remote ref"), or the repository itself is (the hosted remote answers 404
 * until the first push creates it). Both mean the same thing to a sync pass —
 * rebase onto nothing, and let the push below create what was missing. A
 * mistyped BYO remote also lands here and fails honestly at that push.
 */
export function isMissingRemoteRef(cause: unknown): boolean {
  return (
    cause instanceof GitError &&
    /couldn't find remote ref|repository .+ not found|returned error: 404/i.test(cause.stderr)
  );
}
