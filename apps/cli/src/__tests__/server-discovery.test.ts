// Server discovery resolves against the app's OWN config module, so these
// tests pin the layering (env url → configured port → derived range + prod
// fallback) and the probe behavior with an injected fetch.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEV_PORT_PROBE_LIMIT,
  PROD_SERVER_PORT,
  resolveDevDefaultPort,
  resolveDevInstanceId,
} from "@repo/app/node/config";
import { afterEach, describe, expect, it } from "vitest";
import { CliExitError, EXIT_UNREACHABLE } from "../cli-error";
import { deriveServerCandidates, resolveServerBaseUrl, type ProbeFetch } from "../server-discovery";

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

function fixture(): { homeDir: string; appCheckoutDir: string } {
  return {
    homeDir: makeTempDir("inteligir-cli-home-"),
    appCheckoutDir: makeTempDir("inteligir-cli-app-"),
  };
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
    expect(candidates).toEqual({
      kind: "ports",
      ports: [
        ...Array.from({ length: DEV_PORT_PROBE_LIMIT }, (_, offset) => derived + offset),
        PROD_SERVER_PORT,
      ],
    });
  });

  it("honors INTELIGIR_PORT exactly — configured ports are never probed", () => {
    const { homeDir, appCheckoutDir } = fixture();
    expect(
      deriveServerCandidates({
        env: { INTELIGIR_PORT: "5555" },
        appCheckoutDir,
        homeDir,
      }),
    ).toEqual({ kind: "ports", ports: [5555] });
  });

  it("honors the managed config.json port exactly", () => {
    const { homeDir, appCheckoutDir } = fixture();
    const dataDir = join(homeDir, ".inteligir-dev", resolveDevInstanceId(appCheckoutDir), "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ port: 7777 }), "utf8");
    expect(deriveServerCandidates({ env: {}, appCheckoutDir, homeDir })).toEqual({
      kind: "ports",
      ports: [7777],
    });
  });

  it("dials only the prod port under NODE_ENV=production", () => {
    const { homeDir, appCheckoutDir } = fixture();
    expect(
      deriveServerCandidates({ env: { NODE_ENV: "production" }, appCheckoutDir, homeDir }),
    ).toEqual({ kind: "ports", ports: [PROD_SERVER_PORT] });
  });
});

function fetchAnsweringOn(port: number, body: unknown = { ok: true }): ProbeFetch {
  return async (url) => {
    if (new URL(url).port === String(port)) {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("ECONNREFUSED");
  };
}

describe("resolveServerBaseUrl", () => {
  it("returns the first candidate that answers health with the contract body", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const derived = resolveDevDefaultPort(appCheckoutDir);
    // The instance lost its derived port at bind and probed up two.
    const baseUrl = await resolveServerBaseUrl({
      env: {},
      appCheckoutDir,
      homeDir,
      fetchImpl: fetchAnsweringOn(derived + 2),
    });
    expect(baseUrl).toBe(`http://127.0.0.1:${derived + 2}`);
  });

  it("rejects a port whose 200 is not the health body — another local service", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const derived = resolveDevDefaultPort(appCheckoutDir);
    await expect(
      resolveServerBaseUrl({
        env: { INTELIGIR_PORT: String(derived) },
        appCheckoutDir,
        homeDir,
        fetchImpl: fetchAnsweringOn(derived, { hello: "grafana" }),
      }),
    ).rejects.toThrow(CliExitError);
  });

  it("exits 3 naming the tried ports when nothing answers", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const failure = await resolveServerBaseUrl({
      env: { INTELIGIR_PORT: "6042" },
      appCheckoutDir,
      homeDir,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CliExitError);
    if (failure instanceof CliExitError) {
      expect(failure.exitCode).toBe(EXIT_UNREACHABLE);
      expect(failure.message).toContain("6042");
      expect(failure.message).toContain("INTELIGIR_SERVER_URL");
    }
  });

  it("trusts an explicit INTELIGIR_SERVER_URL without probing", async () => {
    const { homeDir, appCheckoutDir } = fixture();
    const baseUrl = await resolveServerBaseUrl({
      env: { INTELIGIR_SERVER_URL: "http://127.0.0.1:4040" },
      appCheckoutDir,
      homeDir,
      fetchImpl: async () => {
        throw new Error("must not probe an explicit URL");
      },
    });
    expect(baseUrl).toBe("http://127.0.0.1:4040");
  });
});
