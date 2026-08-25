import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEV_DATA_ROOT_DIR,
  PROD_DATA_DIR_NAME,
  PROD_SERVER_PORT,
  resolveAppConfig,
  resolveCheckoutRoot,
  resolveDevDefaultPort,
  resolveDevInstanceId,
} from "../config";
import { makeTempDir } from "./temp-dir";

describe("the checkout root", () => {
  it("is the tree's top, whichever directory the process started in", () => {
    // The failure this removes: `pnpm dev` runs the shell from apps/desktop and
    // `pnpm cli …` runs from wherever the developer stands, so hashing the raw
    // cwd hands the CLI a different dev instance than the server it is looking
    // for — and the CLI reports no server while one is plainly running.
    const root = makeTempDir("inteligir-checkout-test-");
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const nested = join(root, "apps", "desktop");
    mkdirSync(nested, { recursive: true });

    expect(resolveCheckoutRoot(nested)).toBe(resolveCheckoutRoot(root));
    expect(resolveDevInstanceId(resolveCheckoutRoot(nested))).toBe(
      resolveDevInstanceId(resolveCheckoutRoot(root)),
    );
  });

  it("falls back to where it started when no checkout contains it", () => {
    // A packaged install has no workspace file above it, and the walk must
    // answer rather than climb to `/` and hash the filesystem root — every
    // install would then share one dev instance.
    const orphan = makeTempDir("inteligir-checkout-test-");
    expect(resolveCheckoutRoot(orphan)).toBe(realpathSync(orphan));
  });
});

describe("data dir", () => {
  it("prod defaults to ~/.inteligir", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { NODE_ENV: "production" },
      homeDir,
    });
    expect(config.mode).toBe("prod");
    expect(config.dataDir).toBe(join(homeDir, PROD_DATA_DIR_NAME));
    expect(config.databasePath).toBe(join(homeDir, PROD_DATA_DIR_NAME, "inteligir.db"));
    expect(config.port).toBe(PROD_SERVER_PORT);
  });

  it("dev derives a per-checkout dir and port from the checkout path", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const a = resolveAppConfig({ checkoutPath: "/checkout/a", env: {}, homeDir });
    const b = resolveAppConfig({ checkoutPath: "/checkout/b", env: {}, homeDir });

    const instanceDir = join(homeDir, DEV_DATA_ROOT_DIR, resolveDevInstanceId("/checkout/a"));
    expect(a.dataDir).toBe(join(instanceDir, "data"));
    // Siblings under the instance dir: the vault is a git repo the sync loop
    // pushes, so it and the data dir must be disjoint.
    expect(a.vaultDir).toBe(join(instanceDir, "vault"));
    expect(a.dataDir).not.toBe(b.dataDir);
    expect(a.port).toBe(resolveDevDefaultPort("/checkout/a"));
    expect(a.port).not.toBe(b.port);

    // Deterministic: the same checkout always lands in the same place.
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
    expect(config.dataDir).toBe(join(homeDir, "custom-data"));
  });

  it("refuses an empty INTELIGIR_DATA_DIR", () => {
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: "  " },
        homeDir: makeTempDir("inteligir-config-test-"),
      }),
    ).toThrow(/INTELIGIR_DATA_DIR/);
  });

  it("refuses a relative INTELIGIR_DATA_DIR with an actionable message", () => {
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: "relative/data" },
        homeDir: makeTempDir("inteligir-config-test-"),
      }),
    ).toThrow(/INTELIGIR_DATA_DIR must be an absolute path \(got "relative\/data"\)/);
  });

  it("records where the data dir and port came from", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const derived = resolveAppConfig({ checkoutPath: "/checkout/a", env: {}, homeDir });
    expect(derived.dataDirSource).toBe("default");
    expect(derived.portSource).toBe("default");

    const dataDir = makeTempDir("inteligir-config-test-");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ port: 4555 }));
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
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ port: 4555 }));
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
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ port: 4555 }));
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
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ port: 4555, futureKey: true }));
    expect(
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: dataDir },
        homeDir,
      }).port,
    ).toBe(4555);

    writeFileSync(join(dataDir, "config.json"), "{not json");
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: dataDir },
        homeDir,
      }),
    ).toThrow(/config\.json/);
  });

  it("refuses a malformed INTELIGIR_PORT", () => {
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_PORT: "not-a-port" },
        homeDir: makeTempDir("inteligir-config-test-"),
      }),
    ).toThrow(/INTELIGIR_PORT/);
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
    expect(prod.vaultDir).toBe(join(homeDir, "Inteligir"));
    expect(prod.vaultRemote).toBeNull();

    const overridden = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_VAULT_DIR: "~/Notes" },
      homeDir,
    });
    expect(overridden.vaultDir).toBe(join(homeDir, "Notes"));
  });

  it("refuses a vault nested in the data dir (and the reverse)", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: dataDir, INTELIGIR_VAULT_DIR: join(dataDir, "vault") },
        homeDir,
      }),
    ).toThrow(/must be disjoint/);
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: join(homeDir, "Vault", "data"), INTELIGIR_VAULT_DIR: "~/Vault" },
        homeDir,
      }),
    ).toThrow(/must be disjoint/);
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
          INTELIGIR_VAULT_DIR: vaultDir,
          INTELIGIR_MODEL_DIR: join(vaultDir, "models"),
        },
        homeDir,
      }),
    ).toThrow(/outside the vault/);
  });

  it("defaults the model dir under the data dir and accepts it beside the vault", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { NODE_ENV: "production" },
      homeDir,
    });
    expect(config.modelDir).toBe(join(homeDir, ".inteligir", "models"));
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

    // A value git would parse as an OPTION must never reach an argv slot.
    expect(() => resolveWithRemote("--upload-pack=/bin/evil")).toThrow(/INTELIGIR_VAULT_REMOTE/);
    expect(() => resolveWithRemote("/plain/local/path")).toThrow(/INTELIGIR_VAULT_REMOTE/);
    expect(() => resolveWithRemote("ext::sh -c evil")).toThrow(/INTELIGIR_VAULT_REMOTE/);
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
    expect(() => resolveWithInterval("-1")).toThrow(/INTELIGIR_SYNC_INTERVAL_MS/);
    expect(() => resolveWithInterval("fast")).toThrow(/INTELIGIR_SYNC_INTERVAL_MS/);
    expect(() => resolveWithInterval("1.5")).toThrow(/INTELIGIR_SYNC_INTERVAL_MS/);
  });
});

describe("the agent selection", () => {
  it("defaults to auto and validates INTELIGIR_AGENT values", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const defaulted = resolveAppConfig({ checkoutPath: "/checkout/a", env: {}, homeDir });
    expect(defaulted.agent).toBe("auto");
    expect(defaulted.agentModel).toBeNull();

    const withEnv = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_AGENT: "scripted", INTELIGIR_AGENT_MODEL: "gpt-5.3-codex" },
      homeDir,
    });
    expect(withEnv.agent).toBe("scripted");
    expect(withEnv.agentModel).toBe("gpt-5.3-codex");

    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_AGENT: "cortex" },
        homeDir,
      }),
    ).toThrow(/INTELIGIR_AGENT/);
  });

  it("reads agent and agentModel from the managed file, env winning", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ agent: "off", agentModel: "m1" }));
    const managed = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir },
      homeDir,
    });
    expect(managed.agent).toBe("off");
    expect(managed.agentModel).toBe("m1");

    const layered = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir, INTELIGIR_AGENT: "codex" },
      homeDir,
    });
    expect(layered.agent).toBe("codex");
    expect(layered.agentModel).toBe("m1");
  });
});
