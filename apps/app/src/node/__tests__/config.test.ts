import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEV_DATA_ROOT_DIR,
  PROD_DATA_DIR_NAME,
  PROD_SERVER_PORT,
  resolveAppConfig,
  resolveDevDefaultPort,
  resolveDevInstanceId,
} from "../config";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-config-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("data dir", () => {
  it("prod defaults to ~/.inteligir", () => {
    const homeDir = makeTempDir();
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
    const homeDir = makeTempDir();
    const a = resolveAppConfig({ checkoutPath: "/checkout/a", env: {}, homeDir });
    const b = resolveAppConfig({ checkoutPath: "/checkout/b", env: {}, homeDir });

    expect(a.dataDir).toBe(join(homeDir, DEV_DATA_ROOT_DIR, resolveDevInstanceId("/checkout/a")));
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
    const homeDir = makeTempDir();
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
        homeDir: makeTempDir(),
      }),
    ).toThrow(/INTELIGIR_DATA_DIR/);
  });

  it("refuses a relative INTELIGIR_DATA_DIR with an actionable message", () => {
    expect(() =>
      resolveAppConfig({
        checkoutPath: "/checkout/a",
        env: { INTELIGIR_DATA_DIR: "relative/data" },
        homeDir: makeTempDir(),
      }),
    ).toThrow(/INTELIGIR_DATA_DIR must be an absolute path \(got "relative\/data"\)/);
  });

  it("records where the data dir and port came from", () => {
    const homeDir = makeTempDir();
    const derived = resolveAppConfig({ checkoutPath: "/checkout/a", env: {}, homeDir });
    expect(derived.dataDirSource).toBe("default");
    expect(derived.portSource).toBe("default");

    const dataDir = makeTempDir();
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
    const homeDir = makeTempDir();
    const dataDir = makeTempDir();
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ port: 4555 }));
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir },
      homeDir,
    });
    expect(config.port).toBe(4555);
  });

  it("lets INTELIGIR_PORT beat the managed file", () => {
    const homeDir = makeTempDir();
    const dataDir = makeTempDir();
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ port: 4555 }));
    const config = resolveAppConfig({
      checkoutPath: "/checkout/a",
      env: { INTELIGIR_DATA_DIR: dataDir, INTELIGIR_PORT: "4777" },
      homeDir,
    });
    expect(config.port).toBe(4777);
  });

  it("tolerates unknown keys in the managed file, refuses invalid JSON", () => {
    const homeDir = makeTempDir();
    const dataDir = makeTempDir();
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
        homeDir: makeTempDir(),
      }),
    ).toThrow(/INTELIGIR_PORT/);
  });
});
