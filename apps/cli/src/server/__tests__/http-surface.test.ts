import {
  HEALTH_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  VOICE_STREAM_PATH,
  WS_PATH,
} from "@repo/api/local/routes";
import { PAIR_CALLBACK_PATH } from "@repo/api/cloud/pairing/pairing-schema";
import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/api/local/connectors/connectors-schema";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "./boot-app";
import { makeTempDir } from "./temp-dir";

function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

const DECLARED_ROUTES = new Map<string, string>([
  [
    key("ALL", `${RPC_PREFIX}/*`),
    "the RPC handler itself — every procedure in the contract arrives here",
  ],
  [
    key("GET", HEALTH_PATH),
    "a supervisor's spawn probe: it must answer before this process has any reason to hold a credential, so it is the one route outside the token gate",
  ],
  [
    key("GET", VAULT_ASSET_PATH),
    "an image's raw BYTES, with an ETag and a 304 on if-none-match — none of which survives an RPC envelope",
  ],
  [key("GET", WS_PATH), "the invalidation bus: subscribe and ping, no payload, by decision"],
  [key("GET", VOICE_STREAM_PATH), "dictation: PCM16 frames up, partial/final down"],
  [
    key("GET", PAIR_CALLBACK_PATH),
    "a BROWSER arriving from the approve page — a cross-site top-level navigation that can carry no token, guarded by its single-use state instead",
  ],
  [
    key("GET", CONNECTOR_OAUTH_CALLBACK_PATH),
    "the same argument with a different provider on the far side",
  ],
]);

// per method: `serveStatic` mounts GET and HEAD separately.
const DECLARED_BUNDLE_ROUTES = new Map<string, string>(
  ["GET", "HEAD"].flatMap((method) => [
    [
      key(method, "/assets/*"),
      "the built bundle's hashed files, the only ones that may be immutable — and a miss must 404 rather than answer the shell, which would hand the module loader HTML",
    ] as const,
    [
      key(method, "/*"),
      "ONE answer per URL and it is the shell: the router reads the URL client-side, so every deep link is the same document",
    ] as const,
  ]),
);

function stagedBundle(): string {
  const clientDir = makeTempDir("inteligir-http-surface-");
  mkdirSync(join(clientDir, "assets"), { recursive: true });
  writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>inteligir</title>");
  return clientDir;
}

// `app.use` middleware registers as ALL on the path it guards, so ALL is dropped except the RPC mount.
function mountedRoutes(routes: readonly { method: string; path: string }[]): Set<string> {
  return new Set(
    routes
      .filter((route) => route.method !== "ALL" || route.path === `${RPC_PREFIX}/*`)
      .map((route) => key(route.method, route.path)),
  );
}

describe.each([
  { mode: "without a bundle", staged: false, extra: new Map<string, string>() },
  { mode: "serving the bundle", staged: true, extra: DECLARED_BUNDLE_ROUTES },
])("the hand-mounted HTTP surface, $mode", ({ staged, extra }) => {
  const declared = new Map([...DECLARED_ROUTES, ...extra]);

  it("is exactly what the table declares, both directions", async () => {
    const options = staged ? { clientDir: stagedBundle() } : {};
    const { composed } = await bootTestApp(options);
    const mounted = mountedRoutes(composed.app.routes);

    const violations: string[] = [];
    for (const route of mounted) {
      if (declared.has(route)) continue;
      violations.push(
        `UNDECLARED ROUTE  ${route}\n` +
          `  rule: a route mounted beside the RPC handler is a deliberate exception to "everything is a procedure"\n` +
          `  fix: add it to DECLARED_ROUTES with the reason it cannot be one — or make it one`,
      );
    }
    for (const [route, why] of declared) {
      if (mounted.has(route)) continue;
      violations.push(
        `UNMOUNTED ROUTE  ${route}\n` +
          `  the row claims: ${why}\n` +
          `  rule: the table states what this server answers; nothing registers this one\n` +
          `  fix: mount it in app.ts, or delete the row`,
      );
    }

    // a genuine `app.all(path)` is also ALL; dropping one is safe only when a non-ALL route on that path shows it guards something.
    const nonAllPaths = new Set(
      composed.app.routes.filter((route) => route.method !== "ALL").map((route) => route.path),
    );
    for (const route of composed.app.routes) {
      if (route.method !== "ALL" || route.path === `${RPC_PREFIX}/*`) continue;
      if (nonAllPaths.has(route.path)) continue;
      violations.push(
        `REACHABLE ALL ROUTE  ALL ${route.path}\n` +
          `  rule: an ALL registration is dropped as middleware only when a non-ALL route on the same path proves it guards something; this one guards nothing declared\n` +
          `  fix: declare it as a real route, or make it a procedure — an untyped ALL surface is exactly what this guard exists to catch`,
      );
    }

    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);

    // a walk that found nothing would satisfy one direction vacuously.
    expect(mounted.size).toBeGreaterThan(0);
    expect(mounted.has(key("GET", HEALTH_PATH))).toBe(true);
  });
});
