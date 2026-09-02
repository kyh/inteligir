import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_DATA_ROOT_DIR, PROD_DATA_DIR_NAME } from "../server/config";
import { resolveDevInstanceId } from "../server/dev-instance";
import { SERVER_FILE_NAME, type ServerFile } from "../server/server-file";
import { describe, expect, it } from "vitest";
import { CliExitError, EXIT_UNREACHABLE } from "../cli-error";
import { DATA_DIR_ENV_VAR, resolveDataDir, resolveServer } from "../server-discovery";
import { makeTempDir } from "../server/__tests__/temp-dir";

function scratch(): string {
  return makeTempDir("inteligir-cli-discovery-");
}

function writeServerRow(dataDir: string, row: Partial<ServerFile>): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, SERVER_FILE_NAME), JSON.stringify(row), "utf8");
}

const CHECKOUT = "/repo";

function captureExit(work: () => void): CliExitError {
  try {
    work();
  } catch (error) {
    if (error instanceof CliExitError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a CliExitError, and nothing was thrown");
}

describe("resolveDataDir", () => {
  it("is the per-checkout dev instance by default — the same one the app derives", () => {
    const homeDir = scratch();
    const dataDir = resolveDataDir({ env: {}, checkoutPath: CHECKOUT, homeDir });
    expect(dataDir).toBe(join(homeDir, DEV_DATA_ROOT_DIR, resolveDevInstanceId(CHECKOUT), "data"));
  });

  it("is the installed data dir under NODE_ENV=production", () => {
    const homeDir = scratch();
    const dataDir = resolveDataDir({
      env: { NODE_ENV: "production" },
      checkoutPath: CHECKOUT,
      homeDir,
    });
    expect(dataDir).toBe(join(homeDir, PROD_DATA_DIR_NAME));
  });

  it("takes INTELIGIR_DATA_DIR verbatim — that is how an agent shell names its instance", () => {
    const homeDir = scratch();
    const named = join(homeDir, "elsewhere");
    expect(
      resolveDataDir({
        env: { [DATA_DIR_ENV_VAR]: named },
        checkoutPath: CHECKOUT,
        homeDir,
      }),
    ).toBe(named);
  });
});

describe("resolveServer", () => {
  it("dials the BOUND port the row names and carries its token", () => {
    const homeDir = scratch();
    const dataDir = join(homeDir, "data");
    writeServerRow(dataDir, {
      port: 24911,
      token: "abc",
      vaultDir: join(homeDir, "vault"),
      pid: 42,
    });
    expect(
      resolveServer({
        env: { [DATA_DIR_ENV_VAR]: dataDir },
        checkoutPath: CHECKOUT,
        homeDir,
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:24911",
      token: "abc",
      dataDir,
      vaultDir: join(homeDir, "vault"),
    });
  });

  it("fails CLOSED when nothing has published itself, naming the data dir", () => {
    const homeDir = scratch();
    const dataDir = join(homeDir, "data");
    mkdirSync(dataDir, { recursive: true });
    const failure = captureExit(() =>
      resolveServer({
        env: { [DATA_DIR_ENV_VAR]: dataDir },
        checkoutPath: CHECKOUT,
        homeDir,
      }),
    );
    expect(failure.exitCode).toBe(EXIT_UNREACHABLE);
    expect(failure.code).toBe("SERVER_UNREACHABLE");
    expect(failure.message).toContain(dataDir);
    expect(failure.message).toContain(DATA_DIR_ENV_VAR);
  });

  it("treats a row it cannot parse as no server at all", () => {
    const homeDir = scratch();
    const dataDir = join(homeDir, "data");
    writeServerRow(dataDir, { port: 24911 });
    expect(() =>
      resolveServer({
        env: { [DATA_DIR_ENV_VAR]: dataDir },
        checkoutPath: CHECKOUT,
        homeDir,
      }),
    ).toThrow(/No inteligir server is running/u);
  });
});
