import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_DATA_ROOT_DIR, PROD_DATA_DIR_NAME, PROD_SERVER_PORT } from "inteligir/server/config";
import { SERVER_FILE_NAME } from "inteligir/server/server-file";
import type { SystemStatusResponse } from "@repo/api/local/system/system-schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeServerVerdict,
  planServerStart,
  resolveServerTarget,
  serverOrigin,
  verifyServer,
  serverEntryPath,
  sessionPartition,
  type ProbeStatus,
} from "../server-instance";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratchHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-shell-home-"));
  scratchDirs.push(dir);
  return dir;
}

/** The managed config the app reads from `<dataDir>/config.json` — only the
 *  two fields these cases pin. */
interface ManagedConfig {
  port?: number;
  vaultDir?: string;
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
        port: PROD_SERVER_PORT,
        dataDir: join(homeDir, PROD_DATA_DIR_NAME),
        vaultDir: join(homeDir, "Inteligir"),
      },
    });
  });

  it("reads the port out of config.json, which is what a spawned child binds", () => {
    // A shell that knows only INTELIGIR_PORT would hand its child 4664 while
    // the app's own resolution says 4700 — two servers, one vault.
    const homeDir = scratchHome();
    writeManagedConfig(join(homeDir, PROD_DATA_DIR_NAME), { port: 4700 });
    const resolved = resolveServerTarget({
      isPackaged: true,
      env: {},
      homeDir,
    });
    expect(resolved.kind === "resolved" && resolved.target.port).toBe(4700);
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
  });

  it("a checkout resolves the per-checkout dev instance, whatever NODE_ENV says", () => {
    // `pnpm dev:desktop` must never drive the developer's real ~/.inteligir
    // and ~/Inteligir; `app.isPackaged` decides the mode, not the ambient env.
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
    expect(resolved.target.port).not.toBe(PROD_SERVER_PORT);
  });

  it("lets INTELIGIR_PORT override the managed config", () => {
    const homeDir = scratchHome();
    writeManagedConfig(join(homeDir, PROD_DATA_DIR_NAME), { port: 4700 });
    const resolved = resolveServerTarget({
      isPackaged: true,
      env: { INTELIGIR_PORT: "4800" },
      homeDir,
    });
    expect(resolved.kind === "resolved" && resolved.target.port).toBe(4800);
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

/** A data dir holding a `server.json` that names `port`, or nothing at all. */
function dataDirWithServer(port: number | null): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-shell-data-"));
  scratchDirs.push(dir);
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
    vaultDir: join(dataDir, "vault"),
    schemaVersion: 1,
    uptimeMs: 1,
    agent: { mode: "off", runtime: "off", detail: null },
  };
}

/** A responder that names `dataDir`, and only for the right bearer — a wrong
 *  one answers nothing, which is what a squatter looks like from here. */
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
    // `localhost` resolves to ::1 on some machines and 127.0.0.1 on others,
    // and the two are different origins to the pin.
    expect(serverOrigin(4664)).toBe("http://127.0.0.1:4664");
  });
});

describe("verifyServer", () => {
  it("verifies a responder that holds this data dir's token and names it back", async () => {
    const dataDir = dataDirWithServer(4700);
    await expect(verifyServer(dataDir, respondingServer(dataDir))).resolves.toEqual({
      kind: "verified",
      live: { origin: "http://127.0.0.1:4700", port: 4700, token: TOKEN },
    });
  });

  it("follows the BOUND port the file names, not the configured one", async () => {
    // A dev instance probes upward when its derived port is taken; a window
    // pinned to the derived value would be pinned to nothing.
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
    // It can read the token (same user, same file) but it is not the instance
    // this shell means — adopting it points the window at the wrong notes.
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

describe("serverEntryPath", () => {
  it("resolves the published bundle under a checkout's node_modules", () => {
    expect(serverEntryPath("/repo/apps/desktop")).toBe(
      "/repo/apps/desktop/node_modules/inteligir/dist/index.js",
    );
  });

  it("rewrites an asar path to the unpacked twin, idempotently", () => {
    // An asar is not a filesystem a process can be forked from, so the entry
    // has to name the unpacked tree — and doing it twice must not produce
    // `app.asar.unpacked.unpacked`.
    const packed = "/Applications/Inteligir.app/Contents/Resources/app.asar";
    const once = serverEntryPath(packed);
    expect(once).toContain("app.asar.unpacked/node_modules/inteligir/dist/index.js");
    expect(serverEntryPath(once.replace("/node_modules/inteligir/dist/index.js", ""))).toBe(once);
  });
});

describe("sessionPartition", () => {
  it("follows the VAULT rather than a name two vaults could share", () => {
    // The shell's own scheme is ONE origin whatever is behind it, so keying
    // storage on it would let two vaults read each other's localStorage.
    expect(sessionPartition("/a/data")).not.toBe(sessionPartition("/b/data"));
    expect(sessionPartition("/a/data")).toBe(sessionPartition("/a/data"));
    expect(sessionPartition("/a/data").startsWith("persist:")).toBe(true);
  });
});
