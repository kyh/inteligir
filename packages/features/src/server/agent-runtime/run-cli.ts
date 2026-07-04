import { execFile } from "node:child_process";

export type RunCliOptions = {
  /** Bytes; how long to wait before SIGTERM. */
  timeoutMs: number;
  /** Bytes; cap on combined stdout buffering. */
  maxBuffer: number;
  /** Optional stdin payload — piped to the child and closed. */
  stdin?: string | undefined;
  /**
   * Message thrown when the binary is missing (ENOENT). Defaults to a
   * generic "<binPath> not installed". Tool wrappers usually want a
   * tool-named message like "peekaboo binary not installed".
   */
  notFoundMessage?: string;
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
      { timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer },
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
