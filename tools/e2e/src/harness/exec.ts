import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
}

class ExecError extends Error {
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

export const exec = async (
  file: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> =>
  // oxlint-disable-next-line promise/avoid-new -- promisify(execFile) drops the captured stdout/stderr into an `unknown` rejection; the callback hands them over typed.
  await new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        encoding: "utf-8",
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
        resolve({ stderr, stdout });
      },
    );
  });

export const describeExecError = (cause: unknown): string => {
  if (cause instanceof ExecError) {
    return [cause.message, cause.stdout.trim(), cause.stderr.trim()]
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return cause instanceof Error ? cause.message : String(cause);
};

const withoutKeys = (env: NodeJS.ProcessEnv, drop: (key: string) => boolean): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !drop(key)));

// every GIT_* swept (GIT_DIR, GIT_INDEX_FILE, …): turbo hashes the checkout through git, and the
// ones a hook runs under would point it at another tree or index than the one being tested
export const hermeticProcessEnv = (): NodeJS.ProcessEnv =>
  withoutKeys(process.env, (key) => key.startsWith("GIT_"));

// an ambient NODE_ENV would build a development bundle, under a turbo key CI never hashes.
export const buildProcessEnv = (): NodeJS.ProcessEnv =>
  withoutKeys(hermeticProcessEnv(), (key) => key === "NODE_ENV");

// the shell's settings are the scenario's alone: an inherited INTELIGIR_* (the cloud it signs in
// to) would move it
export const appLaunchEnv = (): NodeJS.ProcessEnv =>
  withoutKeys(hermeticProcessEnv(), (key) => key.startsWith("INTELIGIR_"));
