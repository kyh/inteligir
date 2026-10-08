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

const withoutKeys = (env: NodeJS.ProcessEnv, drop: (key: string) => boolean): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !drop(key)));

// an ambient NODE_ENV would build a development bundle, under a turbo key CI never hashes.
export const buildProcessEnv = (): NodeJS.ProcessEnv =>
  withoutKeys(hermeticProcessEnv(), (key) => key === "NODE_ENV");

// each would steer the agent off the bundled vendors and their empty stores: the host's own vendor
// binaries, or its credentials.
const HOST_AGENT_ENV: ReadonlySet<string> = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_EXECUTABLE",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CODEX_API_KEY",
  "CODEX_PATH",
  "OPENAI_API_KEY",
]);

// the launch mode states the runtime, never the outer shell: an inherited INTELIGIR_* or NODE_ENV
// moves an instance's dirs or mode.
export const appLaunchEnv = (): NodeJS.ProcessEnv =>
  withoutKeys(
    hermeticProcessEnv(),
    (key) => key.startsWith("INTELIGIR_") || key === "NODE_ENV" || HOST_AGENT_ENV.has(key),
  );
