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

describe("the agent selection", () => {
  it("defaults to auto and validates INTELIGIR_AGENT values", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const defaulted = resolveAppConfig({ checkoutPath: "/checkout/a", env: {}, homeDir });
    expect(defaulted.agent).toBe("auto");

    const withEnv = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_AGENT: "scripted" },
      homeDir,
    });
    expect(withEnv.agent).toBe("scripted");

    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_AGENT: "cortex" },
        homeDir,
      }),
    ).toThrow(/INTELIGIR_AGENT/u);
  });

  it("reads the agent from the managed file, env winning", () => {
    const homeDir = makeTempDir("inteligir-config-test-");
    const dataDir = makeTempDir("inteligir-config-test-");
    writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ agent: "off" }));
    const managed = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir },
      homeDir,
    });
    expect(managed.agent).toBe("off");

    const layered = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_AGENT: "scripted", INTELIGIR_DATA_DIR: dataDir },
      homeDir,
    });
    expect(layered.agent).toBe("scripted");
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
    expect([...resolveWithDebug(" sync , sync,")]).toEqual(["sync"]);
  });

  it("refuses a namespace it does not know, naming the ones it does", () => {
    expect(() => resolveWithDebug("sync,watcher")).toThrow(
      /INTELIGIR_DEBUG must be a comma-separated list of sync \(got "watcher"\)/u,
    );
  });
});
