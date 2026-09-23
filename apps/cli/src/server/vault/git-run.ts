import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const LOCAL_GIT_TIMEOUT_MS = 30_000;
export const NETWORK_GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

const ENGINE_IDENTITY = { email: "vault@inteligir.local", name: "inteligir" };

export interface CommitAuthor {
  name: string;
  email: string;
}

// the committer stays the engine so a commit always says which machine wrote it.
export const identityEnv = (author?: CommitAuthor) => ({
  GIT_AUTHOR_EMAIL: author?.email ?? ENGINE_IDENTITY.email,
  GIT_AUTHOR_NAME: author?.name ?? ENGINE_IDENTITY.name,
  GIT_COMMITTER_EMAIL: ENGINE_IDENTITY.email,
  GIT_COMMITTER_NAME: ENGINE_IDENTITY.name,
});

export class GitError extends Error {
  readonly stderr: string;
  // set when git never finished: the runner's timeout killed it.
  readonly signal: string | null;

  constructor(message: string, stderr: string, signal: string | null = null) {
    super(message);
    this.name = "GitError";
    this.stderr = stderr;
    this.signal = signal;
  }
}

export interface RunGitOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

export type RunGitCommand = (args: readonly string[]) => Promise<{ stdout: string }>;

export type RunGit = typeof runGit;

// git must never wait on a person or a dead network: nobody answers a prompt, and a dropped
// connection otherwise holds a sync pass for the whole network timeout. GIT_TERMINAL_PROMPT=0
// covers git; ssh prompts on its own and only BatchMode=yes refuses it, but a caller's own
// GIT_SSH_COMMAND wins. the low-speed pair aborts a transfer under 1KB/s for 30s, which
// includes a server that accepted the connection and never answered.
const unattendedGitEnv = (env: NodeJS.ProcessEnv) => {
  const unattended = {
    GIT_HTTP_LOW_SPEED_LIMIT: "1000",
    GIT_HTTP_LOW_SPEED_TIME: "30",
    GIT_TERMINAL_PROMPT: "0",
  };
  if (env.GIT_SSH_COMMAND === undefined) {
    return { ...unattended, GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20" };
  }
  return unattended;
};

// execFile's rejection carries the child's stderr and its terminating signal as untyped properties.
const execFileFailure = z.object({ signal: z.string().nullish(), stderr: z.string() });

// --literal-pathspecs on every invocation: a pathspec is a glob, so a commit scoped to
// `[a].md` would also stage `a.md`, and a log for it would report `a.md`'s history.
export const runGit = async (
  cwd: string,
  gitArgs: readonly string[],
  options: RunGitOptions = {},
): Promise<{ stdout: string }> => {
  const pending = execFileAsync("git", ["--literal-pathspecs", ...gitArgs], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...unattendedGitEnv(process.env), ...options.env },
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    timeout: options.timeoutMs ?? LOCAL_GIT_TIMEOUT_MS,
  });
  // execFile hands the child a stdin pipe nobody writes to; closing it turns a read into eof
  // rather than a wait on the timeout.
  pending.child.stdin?.end();
  try {
    const { stdout } = await pending;
    return { stdout };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = execFileFailure.safeParse(error);
    throw new GitError(
      `git ${gitArgs[0] ?? ""} failed: ${message}`,
      failure.success ? failure.data.stderr : "",
      failure.success ? (failure.data.signal ?? null) : null,
    );
  }
};

// never `<root>/.git/…`: in a linked worktree or a submodule `.git` is a file naming the real
// dir, and a worktree keeps its rebase state apart from the info/ its checkouts share.
export const gitPath = async (run: RunGitCommand, root: string, rel: string): Promise<string> => {
  const { stdout } = await run(["rev-parse", "--git-path", rel]);
  return path.resolve(root, stdout.trim());
};

// scp-like git@host:path is not a url and has no password slot, so it passes through.
export const redactRemoteUrl = (url: string): string => {
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
};

// "could not read username" is git answering a 401 challenge with the prompt
// GIT_TERMINAL_PROMPT=0 forbids.
const isAuthRefusal = (cause: unknown): boolean => {
  if (!(cause instanceof GitError)) {
    return false;
  }
  return /authentication failed|returned error: 40[13]|could not read username/iu.test(
    cause.stderr,
  );
};

export type NetworkFailure = "offline" | "unauthorized" | "rejected";

// curl's own failures, and an ssh or local transport that never reached a git on the far end.
const TRANSPORT_FAILURE =
  /unable to access|could not read from remote repository|remote end hung up|rpc failed|early eof/iu;

// curl reports an http status on the same "unable to access" line, but a 4xx is the remote
// answering; only a 408 or a 429 is worth waiting out.
const HTTP_REFUSAL = /returned error: (?!408|429)4\d\d/u;

// the client's refusal, not the remote's: another device pushed after this pass fetched.
const LOST_PUSH_RACE = /\[rejected\][^\n]*\((?:fetch first|non-fast-forward)\)/u;

// offline heals on its own, unauthorized waits on a sign-in, and rejected is a remote that
// answered and refused (a hook, a protected branch), which no retry changes. a lost race is no
// failure of the remote at all: the next pass rebases onto the tip that won.
export const classifyNetworkFailure = (cause: unknown): NetworkFailure | "lost-race" => {
  if (isAuthRefusal(cause)) {
    return "unauthorized";
  }
  if (!(cause instanceof GitError) || cause.signal !== null) {
    return "offline";
  }
  if (TRANSPORT_FAILURE.test(cause.stderr) && !HTTP_REFUSAL.test(cause.stderr)) {
    return "offline";
  }
  return LOST_PUSH_RACE.test(cause.stderr) ? "lost-race" : "rejected";
};

export const isMissingRemoteRepo = (cause: unknown): boolean => {
  if (!(cause instanceof GitError)) {
    return false;
  }
  return /repository .+ (?:not found|does not exist)|returned error: 404|does not appear to be a git repository/iu.test(
    cause.stderr,
  );
};

// a missing branch, or the hosted repo before its first push (404): both mean rebase onto
// nothing and let the push create it.
export const isMissingRemoteRef = (cause: unknown): boolean =>
  cause instanceof GitError &&
  /couldn't find remote ref|repository .+ not found|returned error: 404/iu.test(cause.stderr);
