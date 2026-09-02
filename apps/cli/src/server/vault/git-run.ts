import { execFile } from "node:child_process";

const LOCAL_GIT_TIMEOUT_MS = 30_000;
export const NETWORK_GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

const ENGINE_IDENTITY = { name: "inteligir", email: "vault@inteligir.local" };

export interface CommitAuthor {
  name: string;
  email: string;
}

// the committer stays the engine so a commit always says which machine wrote it.
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

export type RunGitCommand = (args: readonly string[]) => Promise<{ stdout: string }>;

export type RunGit = typeof runGit;

// git must never prompt: every invocation runs under the repo lock, so a credential prompt
// blocks every vault write until the timeout. GIT_TERMINAL_PROMPT=0 covers git; ssh prompts on
// its own and only BatchMode=yes refuses it, but a caller's own GIT_SSH_COMMAND wins.
function nonInteractiveGitEnv(env: NodeJS.ProcessEnv) {
  if (env.GIT_SSH_COMMAND === undefined) {
    return { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
  }
  return { GIT_TERMINAL_PROMPT: "0" };
}

// --literal-pathspecs on every invocation: a pathspec is a glob, so a commit scoped to
// `[a].md` would also stage `a.md`, and a log for it would report `a.md`'s history.
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
    // execFile hands the child a stdin pipe nobody writes to; closing it turns a read into eof
    // rather than a wait on the timeout.
    child.stdin?.end();
  });
}

// scp-like git@host:path is not a url and has no password slot, so it passes through.
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

// "could not read username" is git answering a 401 challenge with the prompt
// GIT_TERMINAL_PROMPT=0 forbids.
export function isAuthRefusal(cause: unknown): boolean {
  if (!(cause instanceof GitError)) {
    return false;
  }
  return /authentication failed|returned error: 40[13]|could not read username/i.test(cause.stderr);
}

export function isMissingRemoteRepo(cause: unknown): boolean {
  if (!(cause instanceof GitError)) {
    return false;
  }
  return /repository .+ (not found|does not exist)|returned error: 404|does not appear to be a git repository/i.test(
    cause.stderr,
  );
}

// a missing branch, or the hosted repo before its first push (404): both mean rebase onto
// nothing and let the push create it.
export function isMissingRemoteRef(cause: unknown): boolean {
  return (
    cause instanceof GitError &&
    /couldn't find remote ref|repository .+ not found|returned error: 404/i.test(cause.stderr)
  );
}
