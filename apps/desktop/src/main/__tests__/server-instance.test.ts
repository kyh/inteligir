import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEV_DATA_ROOT_DIR, PROD_DATA_DIR_NAME } from "inteligir/server/config";
import { SERVER_FILE_NAME } from "inteligir/server/server-file";
import { makeTempDir } from "inteligir/server/testing";
import type { SystemStatusResponse } from "@repo/api/local/system/system-schema";
import { describe, expect, it } from "vitest";
import {
  describeServerVerdict,
  planServerStart,
  resolveServerTarget,
  serverOrigin,
  verifyServer,
  serverEntryPath,
  serverPackageDir,
  sessionPartition,
} from "../server-instance";
import type { LiveServer, ProbeStatus } from "../server-instance";

const scratchHome = (): string => makeTempDir("inteligir-shell-home-");

interface ManagedConfig {
  vaultDir: string;
}

const writeManagedConfig = (dataDir: string, config: ManagedConfig): void => {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "config.json"), JSON.stringify(config), "utf-8");
};

describe("resolveServerTarget", () => {
  it("takes the packaged defaults from the app's own resolution", () => {
    const homeDir = scratchHome();
    const resolved = resolveServerTarget({
      env: {},
      homeDir,
      isPackaged: true,
    });
    expect(resolved).toEqual({
      kind: "resolved",
      target: {
        dataDir: path.join(homeDir, PROD_DATA_DIR_NAME),
        dataDirSource: "default",
        rootDataDir: path.join(homeDir, PROD_DATA_DIR_NAME),
        vaultDir: path.join(homeDir, "Inteligir"),
        vaultDirSource: "default",
      },
    });
  });

  it("carries config.json's vault dir down to the child", () => {
    const homeDir = scratchHome();
    const vaultDir = path.join(homeDir, "Notes");
    writeManagedConfig(path.join(homeDir, PROD_DATA_DIR_NAME), { vaultDir });
    const resolved = resolveServerTarget({
      env: {},
      homeDir,
      isPackaged: true,
    });
    expect(resolved.kind === "resolved" && resolved.target.vaultDir).toBe(vaultDir);
    expect(resolved.kind === "resolved" && resolved.target.vaultDirSource).toBe("managed-config");
    // not the root: a vault other than the default gets a dir of its own beneath it
    expect(resolved.kind === "resolved" && resolved.target.dataDir).not.toBe(
      path.join(homeDir, PROD_DATA_DIR_NAME),
    );
    expect(resolved.kind === "resolved" && resolved.target.rootDataDir).toBe(
      path.join(homeDir, PROD_DATA_DIR_NAME),
    );
  });

  it("resolves a switch candidate as a boot would, refusing a vault that nests the data dir", () => {
    const homeDir = scratchHome();
    const candidate = resolveServerTarget({
      env: {},
      homeDir,
      isPackaged: true,
      vaultDir: path.join(homeDir, "Second"),
    });
    expect(candidate.kind === "resolved" && candidate.target.vaultDir).toBe(
      path.join(homeDir, "Second"),
    );
    expect(candidate.kind === "resolved" && candidate.target.vaultDirSource).toBe("env");
    const nested = resolveServerTarget({
      env: {},
      homeDir,
      isPackaged: true,
      vaultDir: path.join(homeDir, PROD_DATA_DIR_NAME, "notes"),
    });
    expect(nested.kind).toBe("refused");
  });

  it("a checkout resolves the per-checkout dev instance, whatever NODE_ENV says", () => {
    const homeDir = scratchHome();
    const resolved = resolveServerTarget({
      env: { NODE_ENV: "production" },
      homeDir,
      isPackaged: false,
    });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") {
      return;
    }
    const devRoot = path.join(homeDir, DEV_DATA_ROOT_DIR);
    expect(resolved.target.dataDir.startsWith(devRoot)).toBe(true);
    expect(resolved.target.vaultDir.startsWith(devRoot)).toBe(true);
  });

  it("surfaces the app's own refusal rather than falling back to a default", () => {
    const resolved = resolveServerTarget({
      env: { INTELIGIR_PORT: "65536" },
      homeDir: scratchHome(),
      isPackaged: true,
    });
    expect(resolved).toEqual({
      error: "INTELIGIR_PORT must be a valid TCP port",
      kind: "refused",
    });
  });
});
const TOKEN = "device-token";

const dataDirWithServer = (port: number | null): string => {
  const dir = makeTempDir("inteligir-shell-data-");
  if (port !== null) {
    writeFileSync(
      path.join(dir, SERVER_FILE_NAME),
      JSON.stringify({ pid: 4242, port, token: TOKEN, vaultDir: path.join(dir, "vault") }),
      "utf-8",
    );
  }
  return dir;
};

const systemStatus = (dataDir: string): SystemStatusResponse => ({
  agent: { detail: null, mode: "off", runtime: "off" },
  dataDir,
  dataDirScope: "root",
  schemaVersion: 1,
  uptimeMs: 1,
  vaultDir: path.join(dataDir, "vault"),
  version: "0.1.0",
});

interface RespondingServerOptions {
  token?: string;
  claims?: string;
}

const answerFor = (
  dataDir: string,
  options: RespondingServerOptions,
  server: LiveServer,
): SystemStatusResponse | null =>
  server.token === (options.token ?? TOKEN) ? systemStatus(options.claims ?? dataDir) : null;

const respondingServer =
  (dataDir: string, options: RespondingServerOptions = {}): ProbeStatus =>
  async (server) => {
    await Promise.resolve();
    return answerFor(dataDir, options, server);
  };

const silentServer: ProbeStatus = async () => {
  await Promise.resolve();
  return null;
};

describe("serverOrigin", () => {
  it("is loopback by address, never by name", () => {
    expect(serverOrigin(4664)).toBe("http://127.0.0.1:4664");
  });
});

describe("verifyServer", () => {
  it("verifies a responder that holds this data dir's token and names it back", async () => {
    const dataDir = dataDirWithServer(4700);
    await expect(verifyServer(dataDir, respondingServer(dataDir))).resolves.toEqual({
      kind: "verified",
      live: { origin: "http://127.0.0.1:4700", token: TOKEN },
    });
  });

  it("follows the BOUND port the file names, not the configured one", async () => {
    const dataDir = dataDirWithServer(24_911);
    const verdict = await verifyServer(dataDir, respondingServer(dataDir));
    expect(verdict.kind === "verified" && verdict.live.origin).toBe("http://127.0.0.1:24911");
  });

  it("REFUSES a port squatter — it cannot hold a token it never wrote", async () => {
    const dataDir = dataDirWithServer(4700);
    const verdict = await verifyServer(dataDir, respondingServer(dataDir, { token: "other" }));
    expect(verdict).toEqual({ kind: "unreachable", origin: "http://127.0.0.1:4700" });
  });

  it("refuses a real server that serves a different vault", async () => {
    const dataDir = dataDirWithServer(4700);
    const verdict = await verifyServer(
      dataDir,
      respondingServer(dataDir, { claims: "/elsewhere" }),
    );
    expect(verdict).toEqual({
      claimed: "/elsewhere",
      kind: "wrong-data-dir",
      origin: "http://127.0.0.1:4700",
    });
  });

  it("fails CLOSED when the data dir names no server", async () => {
    await expect(verifyServer(dataDirWithServer(null), respondingServer("/x"))).resolves.toEqual({
      kind: "no-server",
    });
  });

  it("reports a stale row as unreachable, not as a stranger", async () => {
    const dataDir = dataDirWithServer(4700);
    await expect(verifyServer(dataDir, silentServer)).resolves.toEqual({
      kind: "unreachable",
      origin: "http://127.0.0.1:4700",
    });
  });
});

describe("describeServerVerdict", () => {
  it.each([
    [{ kind: "no-server" as const }],
    [{ kind: "unreachable" as const, origin: "http://127.0.0.1:4664" }],
  ])("says something a human can act on for %o", (verdict) => {
    expect(describeServerVerdict(verdict, "/data").length).toBeGreaterThan(10);
  });

  it("names the other data dir when that is the mismatch", () => {
    expect(
      describeServerVerdict(
        { claimed: "/elsewhere", kind: "wrong-data-dir", origin: "http://127.0.0.1:4664" },
        "/data",
      ),
    ).toContain("/elsewhere");
  });
});

describe("planServerStart", () => {
  it("adopts only a VERIFIED server", () => {
    expect(planServerStart(true)).toBe("adopt");
  });

  it("spawns its own when nothing verified", () => {
    expect(planServerStart(false)).toBe("spawn");
  });
});

describe("the server entry", () => {
  it("resolves the CLI package under a checkout's node_modules", () => {
    expect(serverPackageDir("/repo/apps/desktop")).toBe(
      "/repo/apps/desktop/node_modules/inteligir",
    );
  });

  it("rewrites an asar path to the unpacked twin, idempotently", () => {
    const packed = "/Applications/Inteligir.app/Contents/Resources/app.asar";
    const once = serverPackageDir(packed);
    expect(once).toContain("app.asar.unpacked/node_modules/inteligir");
    expect(serverPackageDir(`${packed}.unpacked`)).toBe(once);
  });

  it("names the bundle, in a checkout as in a packaged install", () => {
    expect(serverEntryPath("/repo/apps/desktop")).toBe(
      "/repo/apps/desktop/node_modules/inteligir/dist/index.js",
    );
  });
});

describe("sessionPartition", () => {
  it("follows the VAULT rather than a name two vaults could share", () => {
    expect(sessionPartition("/a/data")).not.toBe(sessionPartition("/b/data"));
    expect(sessionPartition("/a/data")).toBe(sessionPartition("/a/data"));
    expect(sessionPartition("/a/data").startsWith("persist:")).toBe(true);
  });
});
