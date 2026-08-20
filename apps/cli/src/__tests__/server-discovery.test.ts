// Server discovery resolves against the app's OWN config module, so these
// tests pin the layering (env url → configured port → derived range + prod
// fallback), and — the part a health probe cannot give — that a responding
// server must PROVE it is this checkout's instance before the CLI writes to
// its vault.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEV_PORT_PROBE_LIMIT,
  PROD_SERVER_PORT,
  resolveDevDefaultPort,
  resolveDevInstanceId,
} from "@repo/app/node/config";
import type { HealthResponse, SystemStatusResponse } from "@repo/server-contract/routes";
import { afterEach, describe, expect, it } from "vitest";
import { CliExitError, EXIT_UNREACHABLE } from "../cli-error";
import { deriveServerCandidates, resolveServer, type ProbeFetch } from "../server-discovery";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

interface Fixture {
  homeDir: string;
  appCheckoutDir: string;
}

function fixture(): Fixture {
  return {
    homeDir: makeTempDir("inteligir-cli-home-"),
    appCheckoutDir: makeTempDir("inteligir-cli-app-"),
  };
}

function expectedDataDirOf(candidates: ReturnType<typeof deriveServerCandidates>): string {
  if (candidates.kind !== "ports") {
    throw new Error("expected derived port candidates");
  }
  return candidates.expectedDataDir;
}

describe("deriveServerCandidates", () => {
  it("takes INTELIGIR_SERVER_URL verbatim, trimmed of trailing slashes", () => {
    const { homeDir, appCheckoutDir } = fixture();
    expect(
      deriveServerCandidates({
        env: { INTELIGIR_SERVER_URL: "http://127.0.0.1:9999/" },
        appCheckoutDir,
        homeDir,
      }),
    ).toEqual({ kind: "url", baseUrl: "http://127.0.0.1:9999" });
  });

  it("refuses a non-URL and a non-http scheme", () => {
    const { homeDir, appCheckoutDir } = fixture();
    for (const bad of ["not a url", "ftp://host:1"]) {
      expect(() =>
        deriveServerCandidates({
          env: { INTELIGIR_SERVER_URL: bad },
          appCheckoutDir,
          homeDir,
        }),
      ).toThrow(CliExitError);
    }
  });

  it("derives the dev probe range plus the prod fallback when nothing is configured", () => {
    const { homeDir, appCheckoutDir } = fixture();
    const derived = resolveDevDefaultPort(appCheckoutDir);
    const candidates = deriveServerCandidates({ env: {}, appCheckoutDir, homeDir });
    expect(candidates.kind).toBe("ports");
    if (candidates.kind !== "ports") {
      return;
    }
    expect(candidates.ports).toEqual([
      ...Array.from({ length: DEV_PORT_PROBE_LIMIT }, (_, offset) => derived + offset),
      PROD_SERVER_PORT,
    ]);
    expect(candidates.expectedDataDir).toContain(resolveDevInstanceId(appCheckoutDir));
  });

  it("honors INTELIGIR_PORT exactly — configured ports are never probed", () => {
    const { homeDir, appCheckoutDir } = fixture();
    const candidates = deriveServerCandidates({
      env: { INTELIGIR_PORT: "5555" },
      appCheckoutDir,
      homeDir,
    });
    expect(candidates.kind === "ports" && candidates.ports).toEqual([5555]);
  });

  it("honors the managed config.json port exactly", () => {
    const { homeDir, appCheckoutDir } = fixture();
    const dataDir = join(homeDir, ".inteligir-dev", resolveDevInstanceId(appCheckoutDir), "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ port: 7777 }), "utf8");
    const candidates = deriveServerCandidates({ env: {}, appCheckoutDir, homeDir });
    expect(candidates.kind === "ports" && candidates.ports).toEqual([7777]);
  });

  it("dials only the prod port under NODE_ENV=production", () => {
    const { homeDir, appCheckoutDir } = fixture();
    const candidates = deriveServerCandidates({
      env: { NODE_ENV: "production" },
      appCheckoutDir,
      homeDir,
    });
    expect(candidates.kind === "ports" && candidates.ports).toEqual([PROD_SERVER_PORT]);
  });
});

function statusBody(dataDir: string): SystemStatusResponse {
  return {
    version: "0.0.0-test",
    dataDir,
    vaultDir: `${dataDir}-vault`,
    schemaVersion: 3,
    uptimeMs: 1,
    agent: { mode: "off", runtime: "off", detail: null },
  };
}

/** What a probed port answers with: this server's own envelopes, or the junk
 *  some other local service on the port returns. */
type ProbeBody = HealthResponse | SystemStatusResponse | { ok?: string; hello?: string };

function jsonResponse(body: ProbeBody): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A server on `port` that reports `dataDir` as its identity. */
function serverOn(port: number, dataDir: string, healthBody: ProbeBody = { ok: true }): ProbeFetch {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.port !== String(port)) {
      throw new Error("ECONNREFUSED");
    }
    if (parsed.pathname.endsWith("/health")) {
      return jsonResponse(healthBody);
    }
    return jsonResponse(statusBody(dataDir));
  };
}

describe("resolveServer", () => {
  it("returns the first candidate that answers health AND claims this instance", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const derived = resolveDevDefaultPort(appCheckoutDir);
    const expected = expectedDataDirOf(
      deriveServerCandidates({ env: {}, appCheckoutDir, homeDir }),
    );
    // The instance lost its derived port at bind and probed up two.
    const resolved = await resolveServer({
      env: {},
      appCheckoutDir,
      homeDir,
      fetchImpl: serverOn(derived + 2, expected),
    });
    expect(resolved).toEqual({ baseUrl: `http://127.0.0.1:${derived + 2}`, source: "discovered" });
  });

  it("SKIPS a neighbouring checkout's server and keeps probing", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const derived = resolveDevDefaultPort(appCheckoutDir);
    const expected = expectedDataDirOf(
      deriveServerCandidates({ env: {}, appCheckoutDir, homeDir }),
    );
    const foreign = serverOn(derived, "/some/other/checkout/data");
    const mine = serverOn(derived + 1, expected);
    const resolved = await resolveServer({
      env: {},
      appCheckoutDir,
      homeDir,
      fetchImpl: async (url, init) => {
        try {
          return await foreign(url, init);
        } catch {
          return mine(url, init);
        }
      },
    });
    expect(resolved.baseUrl).toBe(`http://127.0.0.1:${derived + 1}`);
  });

  it("exits 3 NAMING the conflict when only a foreign instance answers", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const derived = resolveDevDefaultPort(appCheckoutDir);
    const failure = await resolveServer({
      env: {},
      appCheckoutDir,
      homeDir,
      fetchImpl: serverOn(derived, "/some/other/checkout/data"),
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(CliExitError);
    if (failure instanceof CliExitError) {
      expect(failure.exitCode).toBe(EXIT_UNREACHABLE);
      expect(failure.message).toContain("/some/other/checkout/data");
      expect(failure.message).toContain("different instance");
    }
  });

  it("rejects a port whose 200 is not the health body — another local service", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const derived = resolveDevDefaultPort(appCheckoutDir);
    await expect(
      resolveServer({
        env: { INTELIGIR_PORT: String(derived) },
        appCheckoutDir,
        homeDir,
        fetchImpl: serverOn(derived, "/anything", { hello: "grafana" }),
      }),
    ).rejects.toThrow(CliExitError);
  });

  it("exits 3 naming the tried ports when nothing answers", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const failure = await resolveServer({
      env: { INTELIGIR_PORT: "6042" },
      appCheckoutDir,
      homeDir,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(CliExitError);
    if (failure instanceof CliExitError) {
      expect(failure.exitCode).toBe(EXIT_UNREACHABLE);
      expect(failure.message).toContain("6042");
      expect(failure.message).toContain("INTELIGIR_SERVER_URL");
    }
  });

  it("trusts an explicit INTELIGIR_SERVER_URL without probing OR verifying identity", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const resolved = await resolveServer({
      env: { INTELIGIR_SERVER_URL: "http://127.0.0.1:4040" },
      appCheckoutDir,
      homeDir,
      fetchImpl: async () => {
        throw new Error("must not probe an explicit URL");
      },
    });
    expect(resolved).toEqual({ baseUrl: "http://127.0.0.1:4040", source: "explicit" });
  });
});
