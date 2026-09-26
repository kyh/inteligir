import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ORPCError, safe } from "@orpc/client";
import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type { ConnectorTargetInput } from "@repo/api/local/connectors/connectors-schema";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";
import { AgentPrefsStore } from "../../agents/agent-prefs-store";
import { runVendor } from "../../agents/vendor-process";
import { pathContains } from "../../path-containment";
import { claudeConfigPath, createClaudeMcpConfig } from "../claude-mcp-config";
import { codexConfigPath, createCodexMcpConfig } from "../codex-mcp-config";
import { createConnectorsService, createVendorMcpConfigs } from "../connectors-service";
import type { ConnectorsService, CreateConnectorsServiceArgs } from "../connectors-service";
import type { McpSignInRun } from "../mcp-sign-ins";
import { VendorMcpError } from "../vendor-mcp-config";
import { fakeMcpVendors, processAlive } from "./fake-mcp-vendor";
import type { FakeMcpVendors, FakeVendorRun } from "./fake-mcp-vendor";

const URL_ROW = {
  kind: "http",
  url: "https://mcp.example.test/mcp",
} satisfies ConnectorTargetInput;

// a refusal is the port's own class; anything else fails the test as it came.
const refusalFrom = async (work: Promise<unknown>): Promise<VendorMcpError | null> => {
  try {
    await work;
    return null;
  } catch (error) {
    if (error instanceof VendorMcpError) {
      return error;
    }
    throw error;
  }
};

const refusalOf = async (work: Promise<unknown>): Promise<string | null> => {
  const refusal = await refusalFrom(work);
  return refusal === null ? null : refusal.kind;
};

// the first row's sign-in, as the list reads it now.
const firstSignIn = async (service: ConnectorsService) => {
  const { servers } = await service.list();
  return servers[0]?.signIn;
};

const verbsOf = (runs: FakeVendorRun[]): string[] =>
  runs.map((run) => `${run.vendor} ${run.args.slice(0, 2).join(" ")}`);

const configsOver = (vendors: FakeMcpVendors) =>
  createVendorMcpConfigs({ cwd: vendors.dataDir, env: vendors.env });

const serviceOver = (
  vendors: FakeMcpVendors,
  harness: HarnessId,
  overrides: Partial<CreateConnectorsServiceArgs> = {},
) => {
  const service = createConnectorsService({
    configs: configsOver(vendors),
    defaultHarness: () => harness,
    ...overrides,
  });
  onTestFinished(async () => {
    await service.dispose();
  });
  return service;
};

const runOf = (vendors: FakeMcpVendors, verb: string): FakeVendorRun => {
  const run = vendors.runs().find((candidate) => candidate.args[1] === verb);
  if (run === undefined) {
    throw new Error(`no ${verb} ran: ${JSON.stringify(verbsOf(vendors.runs()))}`);
  }
  return run;
};

const settled = async (run: McpSignInRun) => await run.ended;

// every read in a wait spawns a vendor stand-in, which a loaded runner starts slowly.
const SLOW_VENDOR = { interval: 50, timeout: 10_000 };

describe("claude's connectors, over a fake claude", () => {
  it("adds through `mcp add-json -s user`, run in the data dir and never the vault", async () => {
    const vendors = fakeMcpVendors();
    const claude = createClaudeMcpConfig({ cwd: vendors.dataDir, env: vendors.env });

    expect(await claude.add("docs", URL_ROW)).toBeNull();
    expect(
      await claude.add("files", { args: ["-y", "server"], command: "npx", kind: "stdio" }),
    ).toBeNull();

    const [http, stdio] = vendors.runs();
    expect(http?.args).toEqual([
      "mcp",
      "add-json",
      "-s",
      "user",
      "--",
      "docs",
      JSON.stringify({ type: "http", url: URL_ROW.url }),
    ]);
    expect(stdio?.args.at(-1)).toBe(
      JSON.stringify({ args: ["-y", "server"], command: "npx", type: "stdio" }),
    );
    for (const run of vendors.runs()) {
      expect(run.cwd).toBe(vendors.dataDir);
      expect(pathContains(vendors.vaultDir, run.cwd)).toBe(false);
    }
    expect(await claude.list()).toEqual([
      { auth: "unknown", name: "docs", target: URL_ROW },
      {
        auth: "not-needed",
        name: "files",
        target: { args: ["-y", "server"], command: "npx", kind: "stdio" },
      },
    ]);
  });

  it("answers a duplicate add and a missing remove from its own read, running nothing", async () => {
    const vendors = fakeMcpVendors();
    const claude = createClaudeMcpConfig({ cwd: vendors.dataDir, env: vendors.env });
    await claude.add("docs", URL_ROW);

    expect(await refusalOf(claude.add("docs", URL_ROW))).toBe("already-exists");
    expect(await refusalOf(claude.remove("ghost"))).toBe("not-found");
    expect(verbsOf(vendors.runs())).toEqual(["claude mcp add-json"]);
  });

  it("reads the file CLAUDE_CONFIG_DIR names: absent is empty, malformed is refused", async () => {
    const vendors = fakeMcpVendors();
    const claude = createClaudeMcpConfig({ cwd: vendors.dataDir, env: vendors.env });
    expect(claude.configPath).toBe(vendors.claudeConfigFile);
    expect(await claude.list()).toEqual([]);

    writeFileSync(
      vendors.claudeConfigFile,
      JSON.stringify({
        mcpServers: {
          bare: { command: "srv" },
          stream: { type: "sse", url: "https://sse.test" },
          torn: { type: "http" },
        },
        projects: {},
      }),
    );
    expect(await claude.list()).toEqual([
      { auth: "not-needed", name: "bare", target: { args: [], command: "srv", kind: "stdio" } },
      { auth: "unknown", name: "stream", target: { kind: "other", type: "sse" } },
      { auth: "unknown", name: "torn", target: { kind: "other", type: "http" } },
    ]);

    writeFileSync(vendors.claudeConfigFile, "{");
    const refusal = await refusalFrom(claude.list());
    expect(refusal?.kind).toBe("unavailable");
    expect(refusal?.message).toContain(vendors.claudeConfigFile);
  });

  it("finds .claude.json in HOME when CLAUDE_CONFIG_DIR names nothing", () => {
    expect(claudeConfigPath({ HOME: "/Users/ada" })).toBe("/Users/ada/.claude.json");
    expect(claudeConfigPath({ CLAUDE_CONFIG_DIR: "", HOME: "/Users/ada" })).toBe(
      "/Users/ada/.claude.json",
    );
    expect(claudeConfigPath({})).toBe(path.join(homedir(), ".claude.json"));
    expect(codexConfigPath({ HOME: "/Users/ada" })).toBe("/Users/ada/.codex/config.toml");
    expect(codexConfigPath({ CODEX_HOME: "/x/codex" })).toBe("/x/codex/config.toml");
  });

  it("refuses to sign in to a row that is not a URL, or is not there", async () => {
    const vendors = fakeMcpVendors();
    const claude = createClaudeMcpConfig({ cwd: vendors.dataDir, env: vendors.env });
    await claude.add("files", { args: [], command: "srv", kind: "stdio" });
    expect(await refusalOf(claude.signIn("files"))).toBe("not-a-url");
    expect(await refusalOf(claude.signIn("ghost"))).toBe("not-found");
  });

  // the fake refuses a stdin that is no terminal, as `claude mcp login` does.
  it.runIf(process.platform === "darwin")(
    "signs in under a terminal of its own, which the login refuses to run without",
    { timeout: 20_000 },
    async () => {
      const vendors = fakeMcpVendors();
      const claude = createClaudeMcpConfig({ cwd: vendors.dataDir, env: vendors.env });
      await claude.add("docs", URL_ROW);

      const bare = await runVendor(
        HARNESSES.claude,
        ["mcp", "login", "--", "docs"],
        {
          cwd: vendors.dataDir,
          env: vendors.env,
        },
        { signal: AbortSignal.timeout(10_000) },
      );
      expect(bare).toMatchObject({ code: 1, kind: "exited" });

      const run = await claude.signIn("docs");
      await vi.waitFor(() => {
        expect(run.authUrl()).toBe("https://auth.test/authorize?server=docs");
      }, SLOW_VENDOR);
      const login = vendors.runs().findLast((candidate) => candidate.args[1] === "login");
      expect(login).toMatchObject({ args: ["mcp", "login", "--", "docs"], tty: true });
      expect(login?.cwd).toBe(vendors.dataDir);
      vendors.release();
      expect(await settled(run)).toEqual({ kind: "signed-in" });
    },
  );
});

describe("codex's connectors, over a fake codex", () => {
  it("refuses a duplicate add from its list before `mcp add`, which would replace the row", async () => {
    const vendors = fakeMcpVendors();
    const codex = createCodexMcpConfig({ cwd: vendors.dataDir, env: vendors.env });
    await codex.add("docs", URL_ROW);
    const before = vendors.runs().length;

    expect(await refusalOf(codex.add("docs", { args: [], command: "other", kind: "stdio" }))).toBe(
      "already-exists",
    );
    expect(verbsOf(vendors.runs().slice(before))).toEqual(["codex mcp list"]);
    expect(await codex.list()).toEqual([{ auth: "needs-sign-in", name: "docs", target: URL_ROW }]);
  });

  it("refuses a missing remove from its list before `mcp remove`, which would exit 0", async () => {
    const vendors = fakeMcpVendors();
    const codex = createCodexMcpConfig({ cwd: vendors.dataDir, env: vendors.env });
    expect(await refusalOf(codex.remove("ghost"))).toBe("not-found");
    expect(verbsOf(vendors.runs())).toEqual(["codex mcp list"]);
  });

  it("passes a row's name after `--`, so a name the vendor holds is never read as a flag", async () => {
    const vendors = fakeMcpVendors();
    writeFileSync(
      path.join(vendors.env.CODEX_HOME ?? "", "servers.json"),
      JSON.stringify({
        "--help": { auth_status: "unsupported", transport: { command: "x", type: "stdio" } },
      }),
    );
    const codex = createCodexMcpConfig({ cwd: vendors.dataDir, env: vendors.env });
    await codex.remove("--help");
    expect(runOf(vendors, "remove").args).toEqual(["mcp", "remove", "--", "--help"]);
    expect(await codex.list()).toEqual([]);
  });

  it("hands back an add that started a sign-in as that sign-in, still running", async () => {
    const vendors = fakeMcpVendors({ FAKE_CODEX_ADD_SIGN_IN: "1" });
    const codex = createCodexMcpConfig({ cwd: vendors.dataDir, env: vendors.env });
    const run = await codex.add("docs", URL_ROW);
    expect(run?.authUrl()).toBe("https://auth.test/authorize?server=docs");
    expect(processAlive(runOf(vendors, "add").pid)).toBe(true);
    vendors.release();
    expect(run === null ? null : await settled(run)).toEqual({ kind: "signed-in" });
  });

  it("says a sign-in the add started and lost on the row it did add", async () => {
    const vendors = fakeMcpVendors({ FAKE_CODEX_ADD_SIGN_IN: "1", FAKE_SIGN_IN: "fail" });
    const service = serviceOver(vendors, "codex");
    const { servers } = await service.add({ name: "docs", target: URL_ROW });
    const [row] = servers;
    // the fake prints its address before it fails, so the add may have been handed back first.
    await vi.waitFor(async () => {
      expect(await firstSignIn(service)).toEqual({
        detail: "ChatGPT could not finish signing in: the provider refused the sign-in",
        state: "failed",
      });
    }, SLOW_VENDOR);
    expect(row?.name).toBe("docs");
  });
});

describe("the connectors service", () => {
  it("lets two adds of one name race, and exactly one is refused", async () => {
    const vendors = fakeMcpVendors();
    const service = serviceOver(vendors, "codex");
    const outcomes = await Promise.allSettled([
      service.add({ name: "docs", target: URL_ROW }),
      service.add({ name: "docs", target: { args: [], command: "srv", kind: "stdio" } }),
    ]);
    expect(outcomes.map((outcome) => outcome.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    const refused = outcomes.find((outcome) => outcome.status === "rejected");
    expect(
      refused?.status === "rejected" &&
        refused.reason instanceof VendorMcpError &&
        refused.reason.kind,
    ).toBe("already-exists");
    expect(vendors.runs().filter((run) => run.args[1] === "add")).toHaveLength(1);
    for (const run of vendors.runs()) {
      expect(run.cwd).toBe(vendors.dataDir);
    }
  });

  it("lists the default agent's own rows, and follows a change of default at the next call", async () => {
    const vendors = fakeMcpVendors();
    let harness: HarnessId = "claude";
    const service = createConnectorsService({
      configs: configsOver(vendors),
      defaultHarness: () => harness,
    });
    await service.add({ name: "docs", target: URL_ROW });
    expect(await service.list()).toEqual({
      agent: { displayName: "Claude", id: "claude" },
      servers: [{ auth: "unknown", name: "docs", signIn: { state: "idle" }, target: URL_ROW }],
    });
    harness = "codex";
    expect(await service.list()).toEqual({
      agent: { displayName: "ChatGPT", id: "codex" },
      servers: [],
    });
  });

  it("reads a codex add still signing in as pending, and kills it when the row is removed", async () => {
    const vendors = fakeMcpVendors({ FAKE_CODEX_ADD_SIGN_IN: "1" });
    const service = serviceOver(vendors, "codex");
    const added = await service.add({ name: "docs", target: URL_ROW });
    expect(added.servers[0]?.signIn).toEqual({
      state: "pending",
      url: "https://auth.test/authorize?server=docs",
    });
    const { pid } = runOf(vendors, "add");

    const removed = await service.remove("docs");
    expect(removed.servers).toEqual([]);
    expect(processAlive(pid)).toBe(false);
  });

  it("kills a codex add still signing in when its window runs out, and says so on the row", async () => {
    const vendors = fakeMcpVendors({ FAKE_CODEX_ADD_SIGN_IN: "1" });
    const service = serviceOver(vendors, "codex", { signInWindowMs: 300 });
    await service.add({ name: "docs", target: URL_ROW });
    const { pid } = runOf(vendors, "add");
    await vi.waitFor(async () => {
      expect(await firstSignIn(service)).toEqual({
        detail: "The sign-in was not finished in time. Sign in again.",
        state: "failed",
      });
    }, SLOW_VENDOR);
    expect(processAlive(pid)).toBe(false);
  });

  it("kills a sign-in its window ran out on, and offers it again", async () => {
    const vendors = fakeMcpVendors();
    const service = serviceOver(vendors, "codex", { signInWindowMs: 300 });
    await service.add({ name: "docs", target: URL_ROW });
    await service.signIn("docs");
    const { pid } = runOf(vendors, "login");
    await vi.waitFor(async () => {
      expect(await firstSignIn(service)).toMatchObject({ state: "failed" });
    }, SLOW_VENDOR);
    expect(processAlive(pid)).toBe(false);
    await service.signIn("docs");
    expect(vendors.runs().filter((run) => run.args[1] === "login")).toHaveLength(2);
  });

  it("kills every running sign-in at teardown", async () => {
    const vendors = fakeMcpVendors({ FAKE_CODEX_ADD_SIGN_IN: "1" });
    const service = serviceOver(vendors, "codex");
    await service.add({ name: "docs", target: URL_ROW });
    const { pid } = runOf(vendors, "add");
    await service.dispose();
    expect(processAlive(pid)).toBe(false);
  });

  it("leaves a sign-in already running to run, and reads the row idle once it finishes", async () => {
    const vendors = fakeMcpVendors();
    const service = serviceOver(vendors, "codex");
    await service.add({ name: "docs", target: URL_ROW });
    await service.signIn("docs");
    await service.signIn("docs");
    expect(vendors.runs().filter((run) => run.args[1] === "login")).toHaveLength(1);
    vendors.release();
    await vi.waitFor(async () => {
      expect(await firstSignIn(service)).toEqual({ state: "idle" });
    }, SLOW_VENDOR);
    await service.dispose();
  });
});

// assert the refusal class: `rejects.toThrow()` passes for the wrong refusal and for a crash.
describe("the connector procedures", () => {
  it("serve the default agent's rows with their refusal classes", async () => {
    const vendors = fakeMcpVendors();
    const harness = await bootTestApp({ connectors: configsOver(vendors) });
    const added = await harness.client.connectors.add({
      name: "files",
      target: { args: ["run"], command: "npx", kind: "stdio" },
    });
    expect(added.servers.map((row) => row.name)).toEqual(["files"]);

    const refusals = await Promise.all([
      safe(harness.client.connectors.add({ name: "files", target: URL_ROW })),
      safe(harness.client.connectors.remove({ name: "ghost" })),
      safe(harness.client.connectors.signIn({ name: "files" })),
    ]);
    expect(refusals.map(([error]) => error instanceof ORPCError && error.code)).toEqual([
      "ALREADY_EXISTS",
      "NOT_FOUND",
      "BAD_REQUEST",
    ]);

    writeFileSync(vendors.claudeConfigFile, "{");
    const [unreadable] = await safe(harness.client.connectors.list());
    expect(unreadable instanceof ORPCError && unreadable.code).toBe("PROVIDER_UNAVAILABLE");
    expect(unreadable instanceof ORPCError && unreadable.message).toContain(
      vendors.claudeConfigFile,
    );
  });

  it("follow the stored default agent", async () => {
    const vendors = fakeMcpVendors();
    const harness = await bootTestApp({ connectors: configsOver(vendors) });
    new AgentPrefsStore(harness.dataDir).write({ defaultHarness: "codex" });
    const { agent } = await harness.client.connectors.list();
    expect(agent).toEqual({ displayName: "ChatGPT", id: "codex" });
  });

  it("run a booted suite's vendors over stores under its own temp dir, never the Mac's", async () => {
    const harness = await bootTestApp();
    const instanceDir = path.dirname(harness.dataDir);
    const hostFiles = [claudeConfigPath(process.env), codexConfigPath(process.env)];
    for (const config of Object.values(harness.connectors)) {
      expect(pathContains(instanceDir, config.configPath), config.configPath).toBe(true);
      expect(hostFiles).not.toContain(config.configPath);
    }
  });
});
