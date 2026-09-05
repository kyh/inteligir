import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  type ProbeStatus,
} from "../server-instance";

function scratchHome(): string {
  return makeTempDir("inteligir-shell-home-");
}

interface ManagedConfig {
  vaultDir: string;
}

function writeManagedConfig(dataDir: string, config: ManagedConfig): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(config), "utf8");
}

describe("resolveServerTarget", () => {
  it("takes the packaged defaults from the app's own resolution", () => {
    const homeDir = scratchHome();
    const resolved = resolveServerTarget({
      isPackaged: true,
      env: {},
      homeDir,
    });
    expect(resolved).toEqual({
      kind: "resolved",
      target: {
        dataDir: join(homeDir, PROD_DATA_DIR_NAME),
        vaultDir: join(homeDir, "Inteligir"),
        rootDataDir: join(homeDir, PROD_DATA_DIR_NAME),
        vaultDirSource: "default",
        dataDirSource: "default",
      },
    });
  });

  it("carries config.json's vault dir down to the child", () => {
    const homeDir = scratchHome();
    const vaultDir = join(homeDir, "Notes");
    writeManagedConfig(join(homeDir, PROD_DATA_DIR_NAME), { vaultDir });
    const resolved = resolveServerTarget({
      isPackaged: true,
      env: {},
      homeDir,
    });
    expect(resolved.kind === "resolved" && resolved.target.vaultDir).toBe(vaultDir);
    expect(resolved.kind === "resolved" && resolved.target.vaultDirSource).toBe("managed-config");
    // not the root: a vault other than the default gets a dir of its own beneath it
    expect(resolved.kind === "resolved" && resolved.target.dataDir).not.toBe(
      join(homeDir, PROD_DATA_DIR_NAME),
    );
    expect(resolved.kind === "resolved" && resolved.target.rootDataDir).toBe(
      join(homeDir, PROD_DATA_DIR_NAME),
    );
  });

  it("resolves a switch candidate as a boot would, refusing a vault that nests the data dir", () => {
    const homeDir = scratchHome();
    const candidate = resolveServerTarget({
      isPackaged: true,
      env: {},
      homeDir,
      vaultDir: join(homeDir, "Second"),
    });
    expect(candidate.kind === "resolved" && candidate.target.vaultDir).toBe(
      join(homeDir, "Second"),
    );
    expect(candidate.kind === "resolved" && candidate.target.vaultDirSource).toBe("env");
    const nested = resolveServerTarget({
      isPackaged: true,
      env: {},
      homeDir,
      vaultDir: join(homeDir, PROD_DATA_DIR_NAME, "notes"),
    });
    expect(nested.kind).toBe("refused");
  });

  it("a checkout resolves the per-checkout dev instance, whatever NODE_ENV says", () => {
    const homeDir = scratchHome();
    const resolved = resolveServerTarget({
      isPackaged: false,
      env: { NODE_ENV: "production" },
      homeDir,
    });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") {
      return;
    }
    const devRoot = join(homeDir, DEV_DATA_ROOT_DIR);
    expect(resolved.target.dataDir.startsWith(devRoot)).toBe(true);
    expect(resolved.target.vaultDir.startsWith(devRoot)).toBe(true);
  });

  it("surfaces the app's own refusal rather than falling back to a default", () => {
    const resolved = resolveServerTarget({
      isPackaged: true,
      env: { INTELIGIR_PORT: "65536" },
      homeDir: scratchHome(),
    });
    expect(resolved).toEqual({
      kind: "refused",
      error: "INTELIGIR_PORT must be a valid TCP port",
    });
  });
});
const TOKEN = "device-token";

function dataDirWithServer(port: number | null): string {
  const dir = makeTempDir("inteligir-shell-data-");
  if (port !== null) {
    writeFileSync(
      join(dir, SERVER_FILE_NAME),
      JSON.stringify({ port, token: TOKEN, vaultDir: join(dir, "vault"), pid: 4242 }),
      "utf8",
    );
  }
  return dir;
}

function systemStatus(dataDir: string): SystemStatusResponse {
  return {
    version: "0.1.0",
    dataDir,
    dataDirScope: "root",
    vaultDir: join(dataDir, "vault"),
    schemaVersion: 1,
    uptimeMs: 1,
    agent: { mode: "off", runtime: "off", detail: null },
  };
}

function respondingServer(
  dataDir: string,
  options: { token?: string; claims?: string } = {},
): ProbeStatus {
  return (server) =>
    Promise.resolve(
      server.token === (options.token ?? TOKEN) ? systemStatus(options.claims ?? dataDir) : null,
    );
}

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
    const dataDir = dataDirWithServer(24911);
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
      kind: "wrong-data-dir",
      origin: "http://127.0.0.1:4700",
      claimed: "/elsewhere",
    });
  });

  it("fails CLOSED when the data dir names no server", async () => {
    await expect(verifyServer(dataDirWithServer(null), respondingServer("/x"))).resolves.toEqual({
      kind: "no-server",
    });
  });

  it("reports a stale row as unreachable, not as a stranger", async () => {
    const dataDir = dataDirWithServer(4700);
    await expect(verifyServer(dataDir, () => Promise.resolve(null))).resolves.toEqual({
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
        { kind: "wrong-data-dir", origin: "http://127.0.0.1:4664", claimed: "/elsewhere" },
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
