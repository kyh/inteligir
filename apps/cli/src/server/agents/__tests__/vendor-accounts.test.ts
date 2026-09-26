import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVendorAccounts } from "../vendor-accounts";

// a vendor stand-in that records where and with what it ran, then does what FAKE_VENDOR_MODE says.
const FAKE_VENDOR = `#!/bin/sh
pwd -P > "$FAKE_VENDOR_LOG/cwd"
env > "$FAKE_VENDOR_LOG/env"
echo run >> "$FAKE_VENDOR_LOG/runs"
case "$FAKE_VENDOR_MODE" in
  claude-signed-in)
    printf '%s' '{"loggedIn":true,"apiProvider":"firstParty","email":"ada@example.com","subscriptionType":"pro"}'
    ;;
  claude-signed-out)
    printf '%s' '{"loggedIn":false,"apiProvider":"firstParty","authMethod":"none"}'
    exit 1
    ;;
  codex-signed-in)
    echo "Logged in using ChatGPT" >&2
    ;;
  codex-signed-out)
    echo "Not logged in" >&2
    exit 1
    ;;
  garbage)
    echo "something went sideways"
    ;;
  hang)
    sleep 30 &
    echo $! > "$FAKE_VENDOR_LOG/helper"
    wait
    ;;
esac
`;

interface FakeVendor {
  env: NodeJS.ProcessEnv;
  cwd: string;
  runs: () => number;
  recordedEnv: () => string;
  recordedCwd: () => string;
  helperPid: () => number;
}

const fakeVendor = (mode: string): FakeVendor => {
  const dir = makeTempDir("vendor-accounts-", { realpath: true });
  const log = path.join(dir, "log");
  const cwd = path.join(dir, "data");
  mkdirSync(log);
  mkdirSync(cwd);
  const executable = path.join(dir, "vendor");
  writeFileSync(executable, FAKE_VENDOR, { mode: 0o755 });
  const read = (name: string): string => readFileSync(path.join(log, name), "utf-8");
  return {
    cwd,
    env: {
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_EXECUTABLE: executable,
      CODEX_PATH: executable,
      FAKE_VENDOR_LOG: log,
      FAKE_VENDOR_MODE: mode,
      PATH: process.env.PATH,
    },
    helperPid: () => Number(read("helper").trim()),
    recordedCwd: () => read("cwd").trim(),
    recordedEnv: () => read("env"),
    runs: () => {
      try {
        return read("runs").trim().split("\n").length;
      } catch {
        return 0;
      }
    },
  };
};

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("a vendor's account status", () => {
  it("reads a signed-in claude as its plan and email", async () => {
    const vendor = fakeVendor("claude-signed-in");
    const accounts = createVendorAccounts({ cwd: vendor.cwd, env: vendor.env });
    expect(await accounts.status("claude")).toEqual({
      email: "ada@example.com",
      label: "Claude Pro",
      state: "signed-in",
    });
  });

  it("reads each vendor's signed-out answer as signed out", async () => {
    const claude = fakeVendor("claude-signed-out");
    expect(
      await createVendorAccounts({ cwd: claude.cwd, env: claude.env }).status("claude"),
    ).toEqual({ state: "signed-out" });
    const codex = fakeVendor("codex-signed-out");
    expect(await createVendorAccounts({ cwd: codex.cwd, env: codex.env }).status("codex")).toEqual({
      state: "signed-out",
    });
  });

  it("reads codex's exit 0 as signed in", async () => {
    const vendor = fakeVendor("codex-signed-in");
    expect(
      await createVendorAccounts({ cwd: vendor.cwd, env: vendor.env }).status("codex"),
    ).toEqual({ email: null, label: "ChatGPT", state: "signed-in" });
  });

  it("is unknown for an answer it cannot read", async () => {
    const vendor = fakeVendor("garbage");
    expect(
      await createVendorAccounts({ cwd: vendor.cwd, env: vendor.env }).status("claude"),
    ).toMatchObject({ state: "unknown" });
  });

  it("is unknown once a hung vendor runs out its time, and leaves none of its processes behind", async () => {
    const vendor = fakeVendor("hang");
    const accounts = createVendorAccounts({ cwd: vendor.cwd, env: vendor.env, timeoutMs: 300 });
    expect(await accounts.status("claude")).toEqual({
      detail: "Claude did not answer within 0.3s",
      state: "unknown",
    });
    const helper = vendor.helperPid();
    await vi.waitFor(() => {
      expect(processAlive(helper)).toBe(false);
    });
  });

  it("is unknown without running anything when the runtime is missing", async () => {
    const vendor = fakeVendor("claude-signed-in");
    const accounts = createVendorAccounts({
      cwd: vendor.cwd,
      env: { ...vendor.env, CLAUDE_CODE_EXECUTABLE: path.join(vendor.cwd, "gone") },
    });
    expect(await accounts.status("claude")).toMatchObject({ state: "unknown" });
    expect(vendor.runs()).toBe(0);
  });

  it("runs the vendor in the data dir, without the nesting sentinels", async () => {
    const vendor = fakeVendor("claude-signed-in");
    await createVendorAccounts({ cwd: vendor.cwd, env: vendor.env }).status("claude");
    expect(vendor.recordedCwd()).toBe(vendor.cwd);
    const env = vendor.recordedEnv();
    expect(env).toContain(`FAKE_VENDOR_MODE=claude-signed-in`);
    expect(env).not.toMatch(/^CLAUDECODE=/mu);
    expect(env).not.toMatch(/^CLAUDE_CODE_ENTRYPOINT=/mu);
  });

  it("shares one probe between concurrent callers, and asks again only once invalidated", async () => {
    const vendor = fakeVendor("claude-signed-in");
    const accounts = createVendorAccounts({ cwd: vendor.cwd, env: vendor.env });
    const answers = await Promise.all([
      accounts.status("claude"),
      accounts.status("claude"),
      accounts.status("claude"),
    ]);
    expect(new Set(answers.map((answer) => answer.state))).toEqual(new Set(["signed-in"]));
    expect(vendor.runs()).toBe(1);
    await accounts.status("claude");
    expect(vendor.runs()).toBe(1);
    accounts.invalidate("claude");
    await accounts.status("claude");
    expect(vendor.runs()).toBe(2);
  });
});

// the host's env without a vendor override or credential of its own.
const vendorFreeEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:ANTHROPIC|CLAUDE|CODEX|OPENAI)_|^CLAUDECODE$/u.test(key),
    ),
  );

// the vendors' real binaries, the ones the app bundles: the contract the probe rows parse. an empty
// store is signed out, whatever the host running the suite is signed into.
describe("the bundled vendors, over an empty store", () => {
  it("claude auth status --json answers signed out", { timeout: 60_000 }, async () => {
    const dir = makeTempDir("vendor-contract-claude-");
    const accounts = createVendorAccounts({
      cwd: dir,
      env: { ...vendorFreeEnv(), CLAUDE_CONFIG_DIR: dir },
      timeoutMs: 30_000,
    });
    expect(await accounts.status("claude")).toEqual({ state: "signed-out" });
  });

  it("codex login status answers signed out", { timeout: 60_000 }, async () => {
    const dir = makeTempDir("vendor-contract-codex-");
    const accounts = createVendorAccounts({
      cwd: dir,
      env: { ...vendorFreeEnv(), CODEX_HOME: dir },
      timeoutMs: 30_000,
    });
    expect(await accounts.status("codex")).toEqual({ state: "signed-out" });
  });
});
