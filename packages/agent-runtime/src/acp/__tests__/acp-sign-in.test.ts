import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { adapterSpawnEnv, createAcpAgentRuntime } from "../acp-runtime";
import type { AcpAgentRuntimeOptions } from "../acp-runtime";
import { readAuthMethods, runAgentSignIn } from "../acp-sign-in";
import type { AdapterSignInArgs } from "../acp-sign-in";
import { HARNESSES } from "../harness-registry";

const FAKE_AGENT = fileURLToPath(new URL("../../test-support/fake-acp-agent.mjs", import.meta.url));

// a real adapter's boot is a node process importing a large bundle.
const ADAPTER_TIMEOUT_MS = 30_000;

const scratchDir = (): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "acp-sign-in-")));
  onTestFinished(() => {
    rmSync(dir, { force: true, recursive: true });
  });
  return dir;
};

interface FakeSignIn {
  args: AdapterSignInArgs;
  authFile: string;
  children: ChildProcess[];
  recorded: () => string[];
}

const fakeSignIn = (mode: string, signal: AbortSignal = new AbortController().signal) => {
  const dir = scratchDir();
  const authFile = path.join(dir, "auth");
  const recordFile = path.join(dir, "record.ndjson");
  const children: ChildProcess[] = [];
  const spawnAdapter: AcpAgentRuntimeOptions["spawnAdapter"] = (_harness, env, cwd) => {
    const child = spawn(process.execPath, [FAKE_AGENT], {
      cwd,
      env: {
        ...env,
        FAKE_ACP_AUTH_FILE: authFile,
        FAKE_ACP_MODE: mode,
        FAKE_ACP_RECORD: recordFile,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(child);
    return { child };
  };
  const harness = HARNESSES.codex;
  const fake: FakeSignIn = {
    args: {
      cwd: dir,
      env: adapterSpawnEnv(harness, { hostEnv: process.env, model: null, threadId: null }),
      harness,
      signal,
      spawnAdapter,
    },
    authFile,
    children,
    recorded: () =>
      existsSync(recordFile)
        ? readFileSync(recordFile, "utf-8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => z.object({ method: z.string() }).parse(JSON.parse(line)).method)
        : [],
  };
  return fake;
};

const gone = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null;

describe("an agent sign-in", () => {
  it("authenticates with the harness's method, and the adapter writes its store", async () => {
    const fake = fakeSignIn("signIn");
    const result = await runAgentSignIn({ ...fake.args, method: HARNESSES.codex.signIn });
    expect(result).toEqual({ outcome: "signed-in" });
    expect(existsSync(fake.authFile)).toBe(true);
    expect(fake.recorded()).toEqual(["authenticate"]);
    expect(fake.children.every(gone)).toBe(true);
  });

  it("fails naming the adapter's refusal", async () => {
    const fake = fakeSignIn("signInRefused");
    const result = await runAgentSignIn({ ...fake.args, method: HARNESSES.codex.signIn });
    expect(result).toEqual({
      detail:
        "ChatGPT did not finish signing in: Internal error: the login was abandoned in the browser",
      outcome: "failed",
    });
    expect(existsSync(fake.authFile)).toBe(false);
  });

  it("is cancelled by its signal, and a child ignoring SIGTERM is killed before it returns", async () => {
    const cancel = new AbortController();
    const fake = fakeSignIn("signInHang", cancel.signal);
    const pending = runAgentSignIn({ ...fake.args, method: HARNESSES.codex.signIn });
    await expect.poll(fake.recorded, { timeout: ADAPTER_TIMEOUT_MS }).toEqual(["authenticate"]);
    cancel.abort();
    expect(await pending).toEqual({ outcome: "cancelled" });
    expect(fake.children.map((child) => child.signalCode)).toEqual(["SIGKILL"]);
  });

  it("refuses a method the adapter does not offer before asking for it", async () => {
    const fake = fakeSignIn("signIn");
    const result = await runAgentSignIn({
      ...fake.args,
      method: { kind: "agent", methodId: "not-offered" },
    });
    expect(result).toEqual({
      detail: 'ChatGPT does not offer "not-offered" as a way to sign in here.',
      outcome: "failed",
    });
    expect(fake.recorded()).toEqual([]);
    expect(fake.children.every(gone)).toBe(true);
  });

  it("lets a session the vendor refused open once the sign-in wrote its store", async () => {
    const fake = fakeSignIn("signIn");
    const runtime = createAcpAgentRuntime({
      onEvent: () => {
        /* empty */
      },
      spawnAdapter: (_harness, env) => ({
        child: spawn(process.execPath, [FAKE_AGENT], {
          env: { ...env, FAKE_ACP_AUTH_FILE: fake.authFile, FAKE_ACP_MODE: "authOnSessionOpen" },
          stdio: ["pipe", "pipe", "pipe"],
        }),
      }),
      workspacePath: fake.args.cwd,
    });
    onTestFinished(async () => {
      await runtime.shutdown();
    });
    await expect(runtime.startThread({ providerId: "codex", threadId: "thr_1" })).rejects.toThrow(
      /Authentication required/u,
    );

    await runAgentSignIn({ ...fake.args, method: HARNESSES.codex.signIn });
    await runtime.startThread({ providerId: "codex", threadId: "thr_1" });
    expect(runtime.hasThread("thr_1")).toBe(true);
  });
});

// the host's env without a vendor override, credential or remote-session marker of its own: a
// remote session makes claude-agent-acp offer its terminal login instead of the subscription one.
const vendorFreeEnv = (dir: string): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:ANTHROPIC|CLAUDE|CODEX|OPENAI)_|^CLAUDECODE$|^NO_BROWSER$|^SSH_/u.test(key),
    ),
  ),
  CLAUDE_CONFIG_DIR: dir,
  CODEX_HOME: dir,
});

// the pinned adapters themselves, under the initialize every sign-in sends: the ids and args the
// harness rows name are the contract.
describe("the pinned adapters' sign-in methods", () => {
  it(
    "claude-agent-acp offers its subscription login as a terminal run of the bundled claude",
    async () => {
      const dir = scratchDir();
      const harness = HARNESSES.claude;
      const methods = await readAuthMethods({
        cwd: dir,
        env: adapterSpawnEnv(harness, { hostEnv: vendorFreeEnv(dir), model: null, threadId: null }),
        harness,
        signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS),
      });
      expect(methods).toContainEqual(
        expect.objectContaining({
          args: ["--cli", ...harness.signIn.args],
          id: harness.signIn.methodId,
          type: "terminal",
        }),
      );
    },
    ADAPTER_TIMEOUT_MS,
  );

  it(
    "codex-acp offers its ChatGPT login as one it runs itself",
    async () => {
      const dir = scratchDir();
      const harness = HARNESSES.codex;
      const methods = await readAuthMethods({
        cwd: dir,
        env: adapterSpawnEnv(harness, { hostEnv: vendorFreeEnv(dir), model: null, threadId: null }),
        harness,
        signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS),
      });
      const offered = methods.find((method) => method.id === harness.signIn.methodId);
      expect(offered).toBeDefined();
      expect(offered !== undefined && "type" in offered).toBe(false);
    },
    ADAPTER_TIMEOUT_MS,
  );
});
