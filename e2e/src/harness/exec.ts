import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export class ExecError extends Error {
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.name = "ExecError";
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** execFile (no shell), promisified with the output attached to failures. */
export function exec(
  file: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        encoding: "utf8",
        env: options.env ?? process.env,
        timeout: options.timeoutMs ?? 60_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new ExecError(`${file} ${args.join(" ")} failed: ${error.message}`, stdout, stderr),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

/** Hermetic git for fixtures and the app under test: no user/system config
 *  (hooks, signing, default branch), no credential prompts. */
export function hermeticGitEnv(): Record<string, string> {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}
