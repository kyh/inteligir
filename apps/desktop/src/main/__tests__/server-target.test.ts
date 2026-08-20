import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_DATA_ROOT_DIR, PROD_DATA_DIR_NAME, PROD_SERVER_PORT } from "@repo/app/node/config";
import { proveIdentity } from "@repo/app/node/instance-identity";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeIdentityVerdict,
  identityUrl,
  newIdentityChallenge,
  planServerStart,
  resolveServerTarget,
  serverOrigin,
  verifyServerIdentity,
  windowUrl,
} from "../server-target";

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
      appCheckoutDir: "/Applications/Inteligir.app/Contents/Resources/app",
      env: {},
      homeDir,
    });
    expect(resolved).toEqual({
      kind: "resolved",
      target: {
        origin: `http://127.0.0.1:${PROD_SERVER_PORT}`,
        port: PROD_SERVER_PORT,
        dataDir: join(homeDir, PROD_DATA_DIR_NAME),
        vaultDir: join(homeDir, "Inteligir"),
      },
    });
  });

  it("reads the port out of config.json, which is what the window is pinned to", () => {
    // A shell that knows only INTELIGIR_PORT probes 4664, finds nothing, and
    // spawns a child that binds 4700 instead — leaving the window pinned to a
    // dead port while a second server runs against the same vault.
    const homeDir = scratchHome();
    writeManagedConfig(join(homeDir, PROD_DATA_DIR_NAME), { port: 4700 });
    const resolved = resolveServerTarget({
      isPackaged: true,
      appCheckoutDir: "/nowhere",
      env: {},
      homeDir,
    });
    expect(resolved.kind === "resolved" && resolved.target.origin).toBe("http://127.0.0.1:4700");
  });

  it("carries config.json's vault dir down to the child", () => {
    const homeDir = scratchHome();
    const vaultDir = join(homeDir, "Notes");
    writeManagedConfig(join(homeDir, PROD_DATA_DIR_NAME), { vaultDir });
    const resolved = resolveServerTarget({
      isPackaged: true,
      appCheckoutDir: "/nowhere",
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
      appCheckoutDir: "/repo/apps/app",
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
      appCheckoutDir: "/nowhere",
      env: { INTELIGIR_PORT: "4800" },
      homeDir,
    });
    expect(resolved.kind === "resolved" && resolved.target.port).toBe(4800);
  });

  it("surfaces the app's own refusal rather than falling back to a default", () => {
    const resolved = resolveServerTarget({
      isPackaged: true,
      appCheckoutDir: "/nowhere",
      env: { INTELIGIR_PORT: "65536" },
      homeDir: scratchHome(),
    });
    expect(resolved).toEqual({
      kind: "refused",
      error: "INTELIGIR_PORT must be a valid TCP port",
    });
  });
});
const DATA_DIR = "/Users/kyh/.inteligir";
const SECRET = "a".repeat(64);
const CHALLENGE = "b".repeat(64);

/** The local data dir holds SECRET unless a case says otherwise. */
const readSecret = () => SECRET;

describe("serverOrigin", () => {
  it("is loopback by address, never by name", () => {
    // `localhost` resolves to ::1 on some machines and 127.0.0.1 on others,
    // and the two are different origins to the pin.
    expect(serverOrigin(4664)).toBe("http://127.0.0.1:4664");
  });
});

describe("identityUrl", () => {
  it("carries the challenge as an encoded query param", () => {
    expect(identityUrl("http://127.0.0.1:4664", "ab12")).toBe(
      "http://127.0.0.1:4664/api/v1/system/identity?challenge=ab12",
    );
  });
});

describe("newIdentityChallenge", () => {
  it("is fresh every time — a replayed proof must be worthless", () => {
    const first = newIdentityChallenge();
    const second = newIdentityChallenge();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("verifyServerIdentity", () => {
  it("verifies a responder that answers the challenge for the right data dir", () => {
    expect(
      verifyServerIdentity({
        dataDir: DATA_DIR,
        challenge: CHALLENGE,
        answer: { proof: proveIdentity(SECRET, CHALLENGE), dataDir: DATA_DIR },
        readSecret,
      }),
    ).toEqual({ kind: "verified" });
  });

  it("REFUSES a port squatter that answers health but cannot prove anything", () => {
    // The finding in one case: any local process can hold 4664 and return 200.
    expect(
      verifyServerIdentity({
        dataDir: DATA_DIR,
        challenge: CHALLENGE,
        answer: { proof: "0".repeat(64), dataDir: DATA_DIR },
        readSecret,
      }),
    ).toEqual({ kind: "bad-proof" });
  });

  it("refuses a proof computed for a DIFFERENT challenge — no replay", () => {
    expect(
      verifyServerIdentity({
        dataDir: DATA_DIR,
        challenge: CHALLENGE,
        answer: { proof: proveIdentity(SECRET, "c".repeat(64)), dataDir: DATA_DIR },
        readSecret,
      }),
    ).toEqual({ kind: "bad-proof" });
  });

  it("refuses a real server that serves a different vault", () => {
    // It can prove the secret (same user, same file) but it is not the
    // instance this shell means — adopting it points the window at the wrong
    // notes.
    expect(
      verifyServerIdentity({
        dataDir: DATA_DIR,
        challenge: CHALLENGE,
        answer: { proof: proveIdentity(SECRET, CHALLENGE), dataDir: "/Users/kyh/.inteligir-other" },
        readSecret,
      }),
    ).toEqual({ kind: "wrong-data-dir", claimed: "/Users/kyh/.inteligir-other" });
  });

  it("fails CLOSED when the local data dir has no secret to check against", () => {
    expect(
      verifyServerIdentity({
        dataDir: DATA_DIR,
        challenge: CHALLENGE,
        answer: { proof: proveIdentity(SECRET, CHALLENGE), dataDir: DATA_DIR },
        readSecret: () => null,
      }),
    ).toEqual({ kind: "no-secret" });
  });

  it("reports an unanswered challenge as unreachable, not as a bad proof", () => {
    expect(
      verifyServerIdentity({ dataDir: DATA_DIR, challenge: CHALLENGE, answer: null, readSecret }),
    ).toEqual({ kind: "unreachable" });
  });
});

describe("describeIdentityVerdict", () => {
  it.each([
    ["verified" as const],
    ["no-secret" as const],
    ["unreachable" as const],
    ["bad-proof" as const],
  ])("says something a human can act on for %s", (kind) => {
    expect(describeIdentityVerdict({ kind }, "http://127.0.0.1:4664").length).toBeGreaterThan(10);
  });

  it("names the other data dir when that is the mismatch", () => {
    expect(
      describeIdentityVerdict(
        { kind: "wrong-data-dir", claimed: "/elsewhere" },
        "http://127.0.0.1:4664",
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

describe("windowUrl", () => {
  it("is the origin's root", () => {
    expect(windowUrl("http://127.0.0.1:4664")).toBe("http://127.0.0.1:4664/");
  });

  it("refuses a non-http origin instead of loading one", () => {
    expect(() => windowUrl("file:///tmp")).toThrow(/http\(s\) URL/u);
  });
});
