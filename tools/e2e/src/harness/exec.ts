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

// sweeps every GIT_* (GIT_DIR, GIT_INDEX_FILE, GIT_CONFIG_COUNT rows, …) and nulls the
// global/system config so no commit the harness or the app makes depends on the host's hooks,
// signing or identity.
export const hermeticProcessEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) {
      env[key] = value;
    }
  }
  return Object.assign(env, {
    GIT_AUTHOR_EMAIL: "e2e@inteligir.local",
    GIT_AUTHOR_NAME: "e2e-harness",
    GIT_COMMITTER_EMAIL: "e2e@inteligir.local",
    GIT_COMMITTER_NAME: "e2e-harness",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  });
};
