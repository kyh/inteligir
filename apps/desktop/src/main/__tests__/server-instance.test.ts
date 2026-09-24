import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEV_DATA_ROOT_DIR, PROD_DATA_DIR_NAME } from "inteligir/server/config";
import { loopbackOrigin, SERVER_FILE_NAME } from "inteligir/server/server-file";
import type { ServerFile } from "inteligir/server/server-file";
import { silentOwnerSentence } from "inteligir/server/server-probe";
import type { AskServerStatus, StatusAnswer } from "inteligir/server/server-probe";
import { makeTempDir } from "inteligir/server/testing";
import type { SystemStatusResponse } from "@repo/api/local/system/system-schema";
import { describe, expect, it } from "vitest";
import {
  bundledServerVersion,
  describeServerVerdict,
  planServerStart,
  resolveServerTarget,
  verifyServer,
  serverEntryPath,
  serverPackageDir,
  sessionPartition,
} from "../server-instance";
import type { LiveServer, ServerVerdict } from "../server-instance";

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
const VERSION = "0.1.0";

const serverRow = (dataDir: string, port: number, pid: number = process.pid): ServerFile => ({
  pid,
  port,
  token: TOKEN,
  vaultDir: path.join(dataDir, "vault"),
});

// this process's own pid by default, so the row's owner is alive and the probe dials it.
const dataDirWithServer = (port: number | null, pid: number = process.pid): string => {
  const dir = makeTempDir("inteligir-shell-data-");
  if (port !== null) {
    writeFileSync(
      path.join(dir, SERVER_FILE_NAME),
      JSON.stringify(serverRow(dir, port, pid)),
      "utf-8",
    );
  }
  return dir;
};

// spawnSync reaps the child before it returns, so nothing answers to this pid.
const exitedPid = (): number => spawnSync(process.execPath, ["-e", ""]).pid;

const systemStatus = (dataDir: string, version: string): SystemStatusResponse => ({
  agent: { detail: null, mode: "off", runtime: "off" },
  dataDir,
  dataDirScope: "root",
  schemaVersion: 1,
  uptimeMs: 1,
  vaultDir: path.join(dataDir, "vault"),
  version,
});

interface RespondingServerOptions {
  token?: string;
  claims?: string;
  version?: string;
}

const respondingServer =
  (dataDir: string, options: RespondingServerOptions = {}): AskServerStatus =>
  async (row) => {
    await Promise.resolve();
    return row.token === (options.token ?? TOKEN)
      ? {
          body: systemStatus(options.claims ?? dataDir, options.version ?? VERSION),
          kind: "answered",
        }
      : { kind: "refused" };
  };

const answeringWith =
  (answer: StatusAnswer): AskServerStatus =>
  async () => {
    await Promise.resolve();
    return answer;
  };

describe("verifyServer", () => {
  it("verifies a responder that holds this data dir's token and names it back", async () => {
    const dataDir = dataDirWithServer(4700);
    await expect(verifyServer(dataDir, VERSION, respondingServer(dataDir))).resolves.toEqual({
      kind: "verified",
      live: { origin: loopbackOrigin(4700), token: TOKEN },
    });
  });

  it("follows the BOUND port the file names, not the configured one", async () => {
    const dataDir = dataDirWithServer(24_911);
    const verdict = await verifyServer(dataDir, VERSION, respondingServer(dataDir));
    expect(verdict.kind === "verified" && verdict.live.origin).toBe(loopbackOrigin(24_911));
  });

  it("REFUSES a port squatter — it cannot hold a token it never wrote", async () => {
    const dataDir = dataDirWithServer(4700);
    const verdict = await verifyServer(
      dataDir,
      VERSION,
      respondingServer(dataDir, { token: "other" }),
    );
    expect(verdict).toEqual({
      kind: "refused",
      origin: loopbackOrigin(4700),
      row: serverRow(dataDir, 4700),
    });
  });

  it("refuses a real server that serves a different vault", async () => {
    const dataDir = dataDirWithServer(4700);
    const verdict = await verifyServer(
      dataDir,
      VERSION,
      respondingServer(dataDir, { claims: "/elsewhere" }),
    );
    expect(verdict).toEqual({
      claimed: "/elsewhere",
      kind: "wrong-data-dir",
      origin: loopbackOrigin(4700),
    });
  });

  it("refuses to adopt a server of another version, naming both", async () => {
    const dataDir = dataDirWithServer(4700);
    const verdict = await verifyServer(
      dataDir,
      VERSION,
      respondingServer(dataDir, { version: "0.2.0" }),
    );
    expect(verdict).toEqual({
      expected: VERSION,
      kind: "incompatible",
      origin: loopbackOrigin(4700),
      serverVersion: "0.2.0",
    });
  });

  it("reads a newer server's version although its status has grown a field", async () => {
    const dataDir = dataDirWithServer(4700);
    const grown = { ...systemStatus(dataDir, "0.2.0"), newerField: true };
    await expect(
      verifyServer(dataDir, VERSION, answeringWith({ body: grown, kind: "answered" })),
    ).resolves.toMatchObject({ kind: "incompatible", serverVersion: "0.2.0" });
  });

  it("tells an answer it cannot read from silence", async () => {
    const dataDir = dataDirWithServer(4700);
    await expect(
      verifyServer(dataDir, VERSION, answeringWith({ body: { hello: "world" }, kind: "answered" })),
    ).resolves.toEqual({
      kind: "unreadable",
      origin: loopbackOrigin(4700),
      row: serverRow(dataDir, 4700),
    });
    await expect(
      verifyServer(dataDir, VERSION, answeringWith({ kind: "silent" })),
    ).resolves.toEqual({
      kind: "silent",
      origin: loopbackOrigin(4700),
      row: serverRow(dataDir, 4700),
    });
  });

  it("fails CLOSED when the data dir names no server", async () => {
    await expect(
      verifyServer(dataDirWithServer(null), VERSION, respondingServer("/x")),
    ).resolves.toEqual({ kind: "none" });
  });

  it("reports a row whose owner has exited as stale, without dialing it", async () => {
    const pid = exitedPid();
    const dataDir = dataDirWithServer(4700, pid);
    let dialed = false;
    const verdict = await verifyServer(dataDir, VERSION, async (row) => {
      dialed = true;
      return await respondingServer(dataDir)(row);
    });
    expect(verdict).toEqual({ kind: "dead-owner", row: serverRow(dataDir, 4700, pid) });
    expect(dialed).toBe(false);
  });
});

const ROW = serverRow("/data", 4664, 4242);

describe("describeServerVerdict", () => {
  it.each<ServerVerdict>([
    { kind: "none" },
    { kind: "dead-owner", row: ROW },
    { kind: "refused", origin: loopbackOrigin(4664), row: ROW },
    { kind: "unreadable", origin: loopbackOrigin(4664), row: ROW },
  ])("says something a human can act on for %o", (verdict) => {
    expect(describeServerVerdict(verdict, "/data").length).toBeGreaterThan(10);
  });

  it("names the other data dir when that is the mismatch", () => {
    expect(
      describeServerVerdict(
        { claimed: "/elsewhere", kind: "wrong-data-dir", origin: loopbackOrigin(4664) },
        "/data",
      ),
    ).toContain("/elsewhere");
  });

  it("names both versions and the origin when the server is another version", () => {
    const sentence = describeServerVerdict(
      {
        expected: "0.4.0",
        kind: "incompatible",
        origin: loopbackOrigin(4664),
        serverVersion: "0.3.0",
      },
      "/data",
    );
    expect(sentence).toContain("0.4.0");
    expect(sentence).toContain("0.3.0");
    expect(sentence).toContain(loopbackOrigin(4664));
  });

  it("says what the CLI says about a busy owner", () => {
    expect(
      describeServerVerdict({ kind: "silent", origin: loopbackOrigin(4664), row: ROW }, "/data"),
    ).toBe(silentOwnerSentence("/data", { pid: 4242, port: 4664 }));
  });
});

describe("planServerStart", () => {
  const live: LiveServer = { origin: loopbackOrigin(4664), token: TOKEN };

  it("adopts only a VERIFIED server", () => {
    expect(planServerStart({ kind: "verified", live }, "/data")).toEqual({ kind: "adopt", live });
  });

  it.each<ServerVerdict>([
    { kind: "silent", origin: loopbackOrigin(4664), row: ROW },
    {
      expected: VERSION,
      kind: "incompatible",
      origin: loopbackOrigin(4664),
      serverVersion: "0.2.0",
    },
  ])("neither adopts nor spawns over a server that holds the data dir: %o", (verdict) => {
    expect(planServerStart(verdict, "/data")).toEqual({
      kind: "refuse",
      reason: describeServerVerdict(verdict, "/data"),
    });
  });

  it.each<ServerVerdict>([
    { kind: "none" },
    { kind: "dead-owner", row: ROW },
    { kind: "refused", origin: loopbackOrigin(4664), row: ROW },
    { kind: "unreadable", origin: loopbackOrigin(4664), row: ROW },
    { claimed: "/elsewhere", kind: "wrong-data-dir", origin: loopbackOrigin(4664) },
  ])("spawns its own when nothing holds the data dir: %o", (verdict) => {
    expect(planServerStart(verdict, "/data")).toEqual({ kind: "spawn" });
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

  it("expects the version the bundled server's own manifest names", () => {
    const appPath = makeTempDir("inteligir-shell-app-");
    mkdirSync(serverPackageDir(appPath), { recursive: true });
    writeFileSync(
      path.join(serverPackageDir(appPath), "package.json"),
      JSON.stringify({ name: "inteligir", version: "9.9.9" }),
      "utf-8",
    );
    expect(bundledServerVersion(appPath)).toBe("9.9.9");
  });

  it("calls an install with no bundled manifest incomplete", () => {
    expect(() => bundledServerVersion(makeTempDir("inteligir-shell-app-"))).toThrow(/incomplete/u);
  });
});

describe("sessionPartition", () => {
  it("follows the VAULT rather than a name two vaults could share", () => {
    expect(sessionPartition("/a/data")).not.toBe(sessionPartition("/b/data"));
    expect(sessionPartition("/a/data")).toBe(sessionPartition("/a/data"));
    expect(sessionPartition("/a/data").startsWith("persist:")).toBe(true);
  });
});
