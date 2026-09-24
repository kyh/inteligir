import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEV_DATA_ROOT_DIR,
  PROD_DATA_DIR_NAME,
  PROD_SERVER_PORT,
  resolveAppConfig,
} from "../config";
import { resolveDevDefaultPort, resolveDevInstanceId } from "../dev-instance";
import { makeTempDir } from "./temp-dir";

describe("data dir", () => {
  it("prod defaults to ~/.inteligir", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { NODE_ENV: "production" },
      homeDir,
    });
    expect(config.mode).toBe("prod");
    expect(config.dataDir).toBe(path.join(homeDir, PROD_DATA_DIR_NAME));
    expect(config.databasePath).toBe(path.join(homeDir, PROD_DATA_DIR_NAME, "inteligir.db"));
    expect(config.port).toBe(PROD_SERVER_PORT);
  });

  it("dev derives a per-checkout dir and port from the checkout path", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const a = resolveAppConfig({ checkoutPath: "/checkout/a", env: {}, homeDir });
    const b = resolveAppConfig({ checkoutPath: "/checkout/b", env: {}, homeDir });

    const instanceDir = path.join(homeDir, DEV_DATA_ROOT_DIR, resolveDevInstanceId("/checkout/a"));
    expect(a.dataDir).toBe(path.join(instanceDir, "data"));
    expect(a.vaultDir).toBe(path.join(instanceDir, "vault"));
    expect(a.dataDir).not.toBe(b.dataDir);
    expect(a.port).toBe(resolveDevDefaultPort("/checkout/a"));
    expect(a.port).not.toBe(b.port);

    const again = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: {},
      homeDir,
    });
    expect(again.dataDir).toBe(a.dataDir);
    expect(again.port).toBe(a.port);
  });

  it("INTELIGIR_DATA_DIR overrides both modes and expands ~", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: "~/custom-data" },
      homeDir,
    });
    expect(config.dataDir).toBe(path.join(homeDir, "custom-data"));
  });

  it("refuses an empty INTELIGIR_DATA_DIR", () => {
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: "  " },
        homeDir: makeTempDir("inteligir-config-test-"),
      }),
    ).toThrow(/INTELIGIR_DATA_DIR/u);
  });

  it("refuses a relative INTELIGIR_DATA_DIR with an actionable message", () => {
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: "relative/data" },
        homeDir: makeTempDir("inteligir-config-test-"),
      }),
    ).toThrow(/INTELIGIR_DATA_DIR must be an absolute path \(got "relative\/data"\)/u);
  });

  it("records where the data dir and port came from", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const derived = resolveAppConfig({ checkoutPath: "/checkout/a", env: {}, homeDir });
    expect(derived.dataDirSource).toBe("default");
    expect(derived.portSource).toBe("default");

    const dataDir = makeTempDir("inteligir-config-test-");
    writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ port: 4555 }));
    const managed = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir },
      homeDir,
    });
    expect(managed.dataDirSource).toBe("env");
    expect(managed.portSource).toBe("managed-config");

    const env = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir, INTELIGIR_PORT: "4777" },
      homeDir,
    });
    expect(env.portSource).toBe("env");
  });
});

describe("port layering: env → managed file → default", () => {
  it("reads the managed config file when no env var is set", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ port: 4555 }));
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir },
      homeDir,
    });
    expect(config.port).toBe(4555);
  });

  it("lets INTELIGIR_PORT beat the managed file", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ port: 4555 }));
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir, INTELIGIR_PORT: "4777" },
      homeDir,
    });
    expect(config.port).toBe(4777);
  });

  it("tolerates unknown keys in the managed file, refuses invalid JSON", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify({ futureKey: true, port: 4555 }),
    );
    expect(
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: dataDir },
        homeDir,
      }).port,
    ).toBe(4555);

    writeFileSync(path.join(dataDir, "config.json"), "{not json");
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: dataDir },
        homeDir,
      }),
    ).toThrow(`${path.join(dataDir, "config.json")} is not valid JSON`);
  });

  it("names the file and the offending key when the managed file has the wrong shape", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ port: "4555" }));
    const boot = () =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: dataDir },
        homeDir,
      });
    expect(boot).toThrow(`${path.join(dataDir, "config.json")} does not match`);
    expect(boot).toThrow(/at port/u);
  });

  it("refuses a malformed INTELIGIR_PORT", () => {
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_PORT: "not-a-port" },
        homeDir: makeTempDir("inteligir-config-test-"),
      }),
    ).toThrow(/INTELIGIR_PORT/u);
  });
});

describe("the vault dir and remote", () => {
  it("prod defaults the vault to ~/Inteligir; INTELIGIR_VAULT_DIR overrides", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const prod = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { NODE_ENV: "production" },
      homeDir,
    });
    expect(prod.vaultDir).toBe(path.join(homeDir, "Inteligir"));
    expect(prod.vaultRemote).toBeNull();

    const overridden = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_VAULT_DIR: "~/Notes" },
      homeDir,
    });
    expect(overridden.vaultDir).toBe(path.join(homeDir, "Notes"));
  });

  it("refuses a vault nested in the data dir (and the reverse)", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: dataDir, INTELIGIR_VAULT_DIR: path.join(dataDir, "vault") },
        homeDir,
      }),
    ).toThrow(/must be disjoint/u);
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: {
          INTELIGIR_DATA_DIR: path.join(homeDir, "Vault", "data"),
          INTELIGIR_VAULT_DIR: "~/Vault",
        },
        homeDir,
      }),
    ).toThrow(/must be disjoint/u);
  });

  it("refuses a model dir inside the vault — a model would be committed and pushed", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    const vaultDir = makeTempDir("inteligir-config-test-");
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: {
          INTELIGIR_DATA_DIR: dataDir,
          INTELIGIR_MODEL_DIR: path.join(vaultDir, "models"),
          INTELIGIR_VAULT_DIR: vaultDir,
        },
        homeDir,
      }),
    ).toThrow(/outside the vault/u);
  });

  it("defaults the model dir under the data dir and accepts it beside the vault", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { NODE_ENV: "production" },
      homeDir,
    });
    expect(config.modelDir).toBe(path.join(homeDir, ".inteligir", "models"));
  });

  it("accepts the git remote shapes git dials and refuses the rest", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const resolveWithRemote = (remote: string) =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_VAULT_REMOTE: remote },
        homeDir,
      });

    expect(resolveWithRemote("https://github.com/kyh/vault.git").vaultRemote).toBe(
      "https://github.com/kyh/vault.git",
    );
    expect(resolveWithRemote("ssh://git@github.com/kyh/vault.git").vaultRemote).toBe(
      "ssh://git@github.com/kyh/vault.git",
    );
    expect(resolveWithRemote("git@github.com:kyh/vault.git").vaultRemote).toBe(
      "git@github.com:kyh/vault.git",
    );

    // a value git would parse as an option must never reach an argv slot.
    expect(() => resolveWithRemote("--upload-pack=/bin/evil")).toThrow(/INTELIGIR_VAULT_REMOTE/u);
    expect(() => resolveWithRemote("/plain/local/path")).toThrow(/INTELIGIR_VAULT_REMOTE/u);
    expect(() => resolveWithRemote("ext::sh -c evil")).toThrow(/INTELIGIR_VAULT_REMOTE/u);
  });

  it("INTELIGIR_SYNC_INTERVAL_MS: unset = absent, 0 = disabled (null), positive = cadence", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const resolveWithInterval = (interval?: string) =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: interval === undefined ? {} : { INTELIGIR_SYNC_INTERVAL_MS: interval },
        homeDir,
      });

    expect(resolveWithInterval().vaultSyncIntervalMs).toBeUndefined();
    expect(resolveWithInterval("0").vaultSyncIntervalMs).toBeNull();
    expect(resolveWithInterval("5000").vaultSyncIntervalMs).toBe(5000);
    expect(() => resolveWithInterval("-1")).toThrow(/INTELIGIR_SYNC_INTERVAL_MS/u);
    expect(() => resolveWithInterval("fast")).toThrow(/INTELIGIR_SYNC_INTERVAL_MS/u);
    expect(() => resolveWithInterval("1.5")).toThrow(/INTELIGIR_SYNC_INTERVAL_MS/u);
  });

  it("INTELIGIR_SLOW_READS: unset = none, `<ms>:<path>` = a stall, split at the first colon", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const resolveWithSlowReads = (value?: string) =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: value === undefined ? {} : { INTELIGIR_SLOW_READS: value },
        homeDir,
      });

    expect(resolveWithSlowReads().slowReads).toBeNull();
    expect(resolveWithSlowReads("30000:notes/slow.md").slowReads).toEqual({
      delayMs: 30_000,
      path: "notes/slow.md",
    });
    expect(resolveWithSlowReads("500:a:b.md").slowReads).toEqual({ delayMs: 500, path: "a:b.md" });
    expect(resolveWithSlowReads("500:").slowReads).toEqual({ delayMs: 500, path: "" });
    expect(() => resolveWithSlowReads("30000")).toThrow(/INTELIGIR_SLOW_READS/u);
    expect(() => resolveWithSlowReads("0:slow.md")).toThrow(/INTELIGIR_SLOW_READS/u);
    expect(() => resolveWithSlowReads("soon:slow.md")).toThrow(/INTELIGIR_SLOW_READS/u);
  });
});

describe("the agent selection", () => {
  it("defaults to auto and validates INTELIGIR_AGENT values", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const defaulted = resolveAppConfig({ checkoutPath: "/checkout/a", env: {}, homeDir });
    expect(defaulted.agent).toBe("auto");
    expect(defaulted.agentModels).toEqual({ claude: null, codex: null });

    const withEnv = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_AGENT: "scripted", INTELIGIR_CODEX_MODEL: "gpt-5.3-codex" },
      homeDir,
    });
    expect(withEnv.agent).toBe("scripted");
    expect(withEnv.agentModels).toEqual({ claude: null, codex: "gpt-5.3-codex" });

    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_AGENT: "cortex" },
        homeDir,
      }),
    ).toThrow(/INTELIGIR_AGENT/u);
  });

  it("reads agent and each harness's model from the managed file, env winning", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify({ agent: "off", agentModels: { claude: "m1", codex: "m2" } }),
    );
    const managed = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir },
      homeDir,
    });
    expect(managed.agent).toBe("off");
    expect(managed.agentModels).toEqual({ claude: "m1", codex: "m2" });

    const layered = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: {
        INTELIGIR_AGENT: "scripted",
        INTELIGIR_CLAUDE_MODEL: "m3",
        INTELIGIR_DATA_DIR: dataDir,
      },
      homeDir,
    });
    expect(layered.agent).toBe("scripted");
    expect(layered.agentModels).toEqual({ claude: "m3", codex: "m2" });
  });
});

const resolveWithDebug = (value?: string) =>
  resolveAppConfig({
    checkoutPath: "/checkout/a",
    env: value === undefined ? {} : { INTELIGIR_DEBUG: value },
    homeDir: makeTempDir("inteligir-config-test-"),
  }).debug;

describe("the diagnostics selection", () => {
  it("reads a comma-separated INTELIGIR_DEBUG, none when unset or empty", () => {
    expect([...resolveWithDebug()]).toEqual([]);
    expect([...resolveWithDebug("")]).toEqual([]);
    expect([...resolveWithDebug(" watcher , sync,")].toSorted()).toEqual(["sync", "watcher"]);
  });

  it("refuses a namespace it does not know, naming the ones it does", () => {
    expect(() => resolveWithDebug("watcher,wacher")).toThrow(
      /INTELIGIR_DEBUG must be a comma-separated list of acp, knowledge, sync, watcher \(got "wacher"\)/u,
    );
  });
});
