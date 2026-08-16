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

/**
 * process.env with every `GIT_*` variable swept out (GIT_DIR, GIT_WORK_TREE,
 * GIT_INDEX_FILE, GIT_CONFIG_COUNT and its KEY/VALUE rows, host identity, …),
 * then hermetic overrides: null'd global/system config (no hooks, no
 * signing), no credential prompts, and an explicit identity so no commit
 * anywhere in the harness depends on the host. Used for the app processes
 * AND every git the harness runs itself.
 */
export function hermeticProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) {
      env[key] = value;
    }
  }
  return Object.assign(env, {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "e2e-harness",
    GIT_AUTHOR_EMAIL: "e2e@inteligir.local",
    GIT_COMMITTER_NAME: "e2e-harness",
    GIT_COMMITTER_EMAIL: "e2e@inteligir.local",
  });
}
