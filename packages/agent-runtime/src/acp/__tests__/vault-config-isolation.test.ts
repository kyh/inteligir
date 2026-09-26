import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { createAcpAgentRuntime } from "../acp-runtime";
import type { AcpAgentRuntimeOptions } from "../acp-runtime";
import { HARNESSES } from "../harness-registry";

// the vault is synced content, so no setting inside it may configure the vendor. The first suite
// pins what the runtime sends; the other two run each pinned adapter against a fake vendor and
// read what the adapter handed it, which is what a vendor would act on.

const testSupport = (name: string): string =>
  fileURLToPath(new URL(`../../test-support/${name}`, import.meta.url));
const FAKE_AGENT = testSupport("fake-acp-agent.mjs");
const FAKE_CLAUDE_CLI = testSupport("fake-claude-cli.mjs");
const FAKE_CODEX_APP_SERVER = testSupport("fake-codex-app-server.mjs");

// the claude setting sources that read files inside the working directory.
const VAULT_SETTING_SOURCES = ["project", "local"];

// a real adapter's boot is a node process importing a large bundle.
const ADAPTER_TIMEOUT_MS = 30_000;

const noEvents = (): void => {
  /* empty */
};

const scratchDir = (): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "vault-config-")));
  onTestFinished(() => {
    rmSync(dir, { force: true, recursive: true });
  });
  return dir;
};

const vaultIn = (dir: string): string => {
  const vault = path.join(dir, "vault");
  mkdirSync(vault);
  return vault;
};

const jsonLines = <T>(file: string, schema: z.ZodType<T>): T[] =>
  readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => schema.parse(JSON.parse(line)));

const runtimeFor = (
  workspacePath: string,
  spawnAdapter?: AcpAgentRuntimeOptions["spawnAdapter"],
): ReturnType<typeof createAcpAgentRuntime> => {
  const runtimeOptions: AcpAgentRuntimeOptions = { onEvent: noEvents, workspacePath };
  if (spawnAdapter !== undefined) {
    runtimeOptions.spawnAdapter = spawnAdapter;
  }
  const runtime = createAcpAgentRuntime(runtimeOptions);
  onTestFinished(async () => {
    await runtime.shutdown();
  });
  return runtime;
};

const stubEnv = (vars: Record<string, string>): void => {
  for (const [name, value] of Object.entries(vars)) {
    vi.stubEnv(name, value);
  }
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
};

const sessionOpenSchema = z.object({
  method: z.enum(["session/new", "session/load"]),
  params: z.object({ _meta: z.unknown().optional() }),
});

describe("a session open", () => {
  it("carries the harness's session meta on session/new and session/load alike", async () => {
    const dir = scratchDir();
    const recordOf = (id: string): string => path.join(dir, `${id}.ndjson`);
    const runtime = runtimeFor(dir, (harness, env) => ({
      child: spawn(process.execPath, [FAKE_AGENT], {
        env: { ...env, FAKE_ACP_RECORD: recordOf(harness.id) },
        stdio: ["pipe", "pipe", "pipe"],
      }),
    }));

    for (const id of ["claude", "codex"] as const) {
      await runtime.startThread({ providerId: id, threadId: `thr_${id}_new` });
      await runtime.resumeThread({
        providerId: id,
        providerThreadId: `prov_${id}`,
        threadId: `thr_${id}_load`,
      });
      const opens = jsonLines(recordOf(id), sessionOpenSchema);
      expect(opens.map((open) => open.method)).toEqual(["session/new", "session/load"]);
      for (const open of opens) {
        expect(open.params._meta).toEqual(HARNESSES[id].sessionMeta ?? undefined);
      }
    }
  });
});

// `--flag=value` or `--flag value`, as the SDK spells either.
const flagValue = (argv: readonly string[], flag: string): string | undefined => {
  const joined = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (joined !== undefined) {
    return joined.slice(flag.length + 1);
  }
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

describe("a claude session", () => {
  it(
    "launches the CLI on the user's settings alone, and a mode the vault sets never reaches it",
    async () => {
      const dir = scratchDir();
      const vault = vaultIn(dir);
      mkdirSync(path.join(vault, ".claude"));
      writeFileSync(
        path.join(vault, ".claude", "settings.local.json"),
        JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
      );
      const record = path.join(dir, "argv.ndjson");
      stubEnv({
        CLAUDE_CODE_EXECUTABLE: FAKE_CLAUDE_CLI,
        CLAUDE_CONFIG_DIR: path.join(dir, "claude-config"),
        FAKE_VENDOR_RECORD: record,
      });

      await expect(
        runtimeFor(vault).startThread({ providerId: "claude", threadId: "thr_claude" }),
      ).rejects.toThrow();

      const launches = jsonLines(record, z.array(z.string())).filter(
        (argv) => flagValue(argv, "--setting-sources") !== undefined,
      );
      expect(launches).not.toHaveLength(0);
      for (const argv of launches) {
        const sources = flagValue(argv, "--setting-sources")?.split(",");
        expect(sources).toEqual(["user"]);
        for (const source of VAULT_SETTING_SOURCES) {
          expect(sources).not.toContain(source);
        }
        // the adapter reads the vault's settings for its starting mode itself, outside the sources.
        expect(flagValue(argv, "--permission-mode")).toBe("default");
      }
    },
    ADAPTER_TIMEOUT_MS,
  );
});

const threadOpenSchema = z.object({
  method: z.enum(["thread/start", "thread/resume"]),
  params: z.object({
    config: z.object({
      projects: z.record(z.string(), z.object({ trust_level: z.string() })),
    }),
    cwd: z.string(),
  }),
});

describe("a codex session", () => {
  it(
    "marks the vault untrusted on session/new and session/load alike",
    async () => {
      const dir = scratchDir();
      const vault = vaultIn(dir);
      // codex-acp starts CODEX_PATH itself, so the fake needs an executable of its own.
      const appServer = path.join(dir, "codex");
      writeFileSync(
        appServer,
        `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CODEX_APP_SERVER}" "$@"\n`,
      );
      chmodSync(appServer, 0o755);
      const record = path.join(dir, "threads.ndjson");
      stubEnv({ CODEX_PATH: appServer, FAKE_VENDOR_RECORD: record });
      const runtime = runtimeFor(vault);

      await expect(
        runtime.startThread({ providerId: "codex", threadId: "thr_codex_new" }),
      ).rejects.toThrow();
      // a refused load falls back to a fresh session, which the fake refuses too.
      await expect(
        runtime.resumeThread({
          providerId: "codex",
          providerThreadId: "prov_codex",
          threadId: "thr_codex_load",
        }),
      ).rejects.toThrow();

      const opens = jsonLines(record, threadOpenSchema);
      expect(opens.map((open) => open.method)).toEqual([
        "thread/start",
        "thread/resume",
        "thread/start",
      ]);
      for (const open of opens) {
        expect(open.params.cwd).toBe(vault);
        expect(open.params.config.projects).toEqual({ [vault]: { trust_level: "untrusted" } });
      }
    },
    ADAPTER_TIMEOUT_MS,
  );
});
