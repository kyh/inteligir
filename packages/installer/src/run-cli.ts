import { execFile } from "node:child_process";

export type RunCliOptions = {
  /** Bytes; how long to wait before SIGTERM. */
  timeoutMs: number;
  /** Bytes; cap on combined stdout buffering. */
  maxBuffer: number;
  /** Optional stdin payload — piped to the child and closed. */
  stdin?: string | undefined;
  /** Environment for the child. Defaults to inheriting process.env. */
  env?: NodeJS.ProcessEnv | undefined;
  /**
   * Message thrown when the binary is missing (ENOENT). Defaults to a
   * generic "<binPath> not installed". Tool wrappers usually want a
   * tool-named message like "peekaboo binary not installed".
   */
  notFoundMessage?: string;
  /**
   * Cancellation. Node kills the child (SIGTERM) when this aborts, so a user
   * interrupt doesn't have to wait out `timeoutMs`. The abort surfaces as a
   * normal resolve — see the AbortError note on runCli — because the caller
   * that owns the signal already knows the run was cancelled and only needs
   * the promise to settle promptly.
   */
  signal?: AbortSignal | undefined;
};

export type RunCliResult = {
  stdout: string;
  stderr: string;
  code: number;
};

/**
 * Spawn `binPath` with `args` and capture stdout/stderr/exit code, with the
 * conventions our pi-extension tools rely on:
 *
 * - ENOENT → reject with `notFoundMessage` so the tool can surface a
 *   user-facing "X not installed" string instead of leaking the spawn error.
 * - Non-numeric `err.code` (system errors like ERR_CHILD_PROCESS_STDIO_MAXBUFFER
 *   come through as strings) → coerced to `1`, never returned as a string.
 * - Resolves on any normal exit, including non-zero; callers decide what
 *   `code !== 0` means for them.
 * - An aborted `opts.signal` kills the child and lands in the same non-numeric
 *   branch (`err.code === "ABORT_ERR"`) → resolves with code 1 and whatever
 *   was buffered. Deliberate: the only caller that can abort is the one that
 *   owns the signal, and it discards the result anyway, so a rejection would
 *   just be an error path every call site has to re-swallow.
 */
export function runCli(
  binPath: string,
  args: string[],
  opts: RunCliOptions,
): Promise<RunCliResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      binPath,
      args,
      {
        timeout: opts.timeoutMs,
        maxBuffer: opts.maxBuffer,
        ...(opts.env ? { env: opts.env } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      (err, stdout, stderr) => {
        const rawCode = err instanceof Error && "code" in err ? err.code : undefined;
        if (rawCode === "ENOENT") {
          reject(new Error(opts.notFoundMessage ?? `${binPath} not installed`));
          return;
        }
        const code = typeof rawCode === "number" ? rawCode : err ? 1 : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
    if (opts.stdin !== undefined) {
      child.stdin?.end(opts.stdin);
    }
  });
}
