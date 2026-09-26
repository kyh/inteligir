import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { messageOf } from "../error-message";

const execFileAsync = promisify(execFile);

const LOCAL_GIT_TIMEOUT_MS = 30_000;
export const NETWORK_GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export interface CommitAuthor {
  name: string;
  email: string;
}

export const ENGINE_IDENTITY: CommitAuthor = { email: "vault@inteligir.local", name: "inteligir" };

// the author says who made the change (the engine, the agent, an undo); the committer names the
// device that committed it, which is how another device's merge says whose version it copied aside.
export const identityEnv = (device: string, author: CommitAuthor = ENGINE_IDENTITY) => ({
  GIT_AUTHOR_EMAIL: author.email,
  GIT_AUTHOR_NAME: author.name,
  GIT_COMMITTER_EMAIL: ENGINE_IDENTITY.email,
  GIT_COMMITTER_NAME: device,
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
  // what git reads on stdin (`hash-object --stdin`); unset, stdin is closed empty.
  input?: string;
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

// execFile's rejection carries the child's stderr and its terminating signal as untyped
// properties; a run that reads bytes carries its stderr as bytes too.
const execFileFailure = z.object({
  signal: z.string().nullish(),
  stderr: z.union([z.string(), z.instanceof(Buffer).transform((bytes) => bytes.toString("utf-8"))]),
});

const gitFailure = (
  gitArgs: readonly string[],
  message: string,
  failure: z.infer<typeof execFileFailure> | null,
): GitError =>
  new GitError(
    `git ${gitArgs[0] ?? ""} failed: ${message}`,
    failure?.stderr ?? "",
    failure?.signal ?? null,
  );

// ahead of every subcommand. --literal-pathspecs: a pathspec is a glob, so a commit scoped to
// `[a].md` would also stage `a.md`, and a log for it would report `a.md`'s history. the vault's
// own hooks never run: one can refuse, stall or rewrite an engine commit, rebase or push, and
// --no-verify reaches only pre-commit and commit-msg.
const engineArgv = (gitArgs: readonly string[]): string[] => [
  "-c",
  "core.hooksPath=/dev/null",
  "--literal-pathspecs",
  ...gitArgs,
];

const engineEnv = (options: RunGitOptions): NodeJS.ProcessEnv => ({
  ...process.env,
  ...unattendedGitEnv(process.env),
  ...options.env,
});

export const runGit = async (
  cwd: string,
  gitArgs: readonly string[],
  options: RunGitOptions = {},
): Promise<{ stdout: string }> => {
  const pending = execFileAsync("git", engineArgv(gitArgs), {
    cwd,
    encoding: "utf-8",
    env: engineEnv(options),
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    timeout: options.timeoutMs ?? LOCAL_GIT_TIMEOUT_MS,
  });
  // execFile hands the child a stdin pipe; closing it once written turns a read into eof rather
  // than a wait on the timeout. a git that exits before reading its input says so through its
  // exit, not a broken pipe.
  pending.child.stdin?.on("error", () => {
    /* empty */
  });
  pending.child.stdin?.end(options.input);
  try {
    const { stdout } = await pending;
    return { stdout };
  } catch (error) {
    const failure = execFileFailure.safeParse(error);
    throw gitFailure(gitArgs, messageOf(error), failure.success ? failure.data : null);
  }
};

// a blob's exact bytes: runGit decodes stdout as utf-8, which would turn every byte of a file
// that is not text into U+FFFD.
export const readGitBlob = async (
  cwd: string,
  oid: string,
  options: RunGitOptions = {},
): Promise<Uint8Array> => {
  const gitArgs = ["cat-file", "blob", oid];
  const pending = execFileAsync("git", engineArgv(gitArgs), {
    cwd,
    encoding: "buffer",
    env: engineEnv(options),
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    timeout: options.timeoutMs ?? LOCAL_GIT_TIMEOUT_MS,
  });
  pending.child.stdin?.end();
  try {
    const { stdout } = await pending;
    return stdout;
  } catch (error) {
    const failure = execFileFailure.safeParse(error);
    throw gitFailure(gitArgs, messageOf(error), failure.success ? failure.data : null);
  }
};

// whether the thin pack a push of `revisions` would send runs past `capBytes`. spawned rather than
// run through runGit, which buffers stdout: the pack is counted as it streams and git is killed
// once the count passes the cap, so no more than the cap is ever read.
export const packExceeds = async (
  cwd: string,
  revisions: readonly string[],
  capBytes: number,
  options: RunGitOptions = {},
): Promise<boolean> => {
  const child = spawn("git", engineArgv(["pack-objects", "--stdout", "--revs", "--thin", "-q"]), {
    cwd,
    env: engineEnv(options),
    timeout: options.timeoutMs ?? LOCAL_GIT_TIMEOUT_MS,
  });
  const exited = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
  child.once("error", exited.reject);
  child.once("close", (code, signal) => {
    exited.resolve({ code, signal });
  });
  let counted = 0;
  let over = false;
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    counted += chunk.length;
    if (!over && counted > capBytes) {
      over = true;
      child.kill();
    }
  });
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  // a git that exits before reading its revisions says so through its exit, not a broken pipe.
  child.stdin.on("error", () => {
    /* empty */
  });
  child.stdin.end(`${revisions.join("\n")}\n`);
  const { code, signal } = await exited.promise;
  if (over) {
    return true;
  }
  if (code !== 0) {
    throw new GitError(
      `git pack-objects failed with ${signal ?? `code ${String(code)}`}`,
      stderr,
      signal,
    );
  }
  return false;
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

export type NetworkFailure = "offline" | "unauthorized" | "rejected" | "too-large";

// curl's own failures, and an ssh or local transport that never reached a git on the far end.
const TRANSPORT_FAILURE =
  /unable to access|could not read from remote repository|remote end hung up|rpc failed|early eof/iu;

// curl reports an http status on the same "unable to access" line, but a 4xx is the remote
// answering; only a 408 or a 429 is worth waiting out.
const HTTP_REFUSAL = /returned error: (?!408|429)4\d\d/u;

// the hosted vault's push cap, or a proxy's body limit in front of a remote of the user's own.
// git drops the body of a failed request, so the status is all a client learns.
const BODY_TOO_LARGE = /returned error: 413/u;

// the client's refusal, not the remote's: another device pushed after this pass fetched.
const LOST_PUSH_RACE = /\[rejected\][^\n]*\((?:fetch first|non-fast-forward)\)/u;

// offline heals on its own, unauthorized waits on a sign-in, and rejected is a remote that
// answered and refused (a hook, a protected branch), which no retry changes; too-large is a
// refusal of the history itself, which no retry changes until that history does. a lost race is
// no failure of the remote at all: the next pass rebases onto the tip that won.
export const classifyNetworkFailure = (cause: unknown): NetworkFailure | "lost-race" => {
  if (isAuthRefusal(cause)) {
    return "unauthorized";
  }
  if (!(cause instanceof GitError) || cause.signal !== null) {
    return "offline";
  }
  if (BODY_TOO_LARGE.test(cause.stderr)) {
    return "too-large";
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
