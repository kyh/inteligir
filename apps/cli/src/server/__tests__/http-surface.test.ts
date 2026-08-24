// ---------------------------------------------------------------------------
// What this server answers OUTSIDE the RPC handler, pinned from both sides.
//
// The procedures need no guard any more: `base.router({...})` in
// `root-router.ts` is a compile-time totality check, so a contract row nobody
// implemented — and a handler that drifts from its row — fails the build. That
// is what the vendored route table's completeness test used to have to do at
// runtime.
//
// What no compiler can see is the OTHER surface: the routes mounted by hand
// beside the handler. Each one is a deliberate exception to "everything is a
// procedure", and each has a reason (`@repo/api/local/routes` states them).
// So the table below is the review surface: a route nobody declared fails
// here rather than quietly becoming a second, untyped API.
//
// Both directions matter. An undeclared route is a surface the contract does
// not describe; a declared route that is not mounted is a promise the wire
// breaks.
// ---------------------------------------------------------------------------

import {
  HEALTH_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  VOICE_STREAM_PATH,
  WS_PATH,
} from "@repo/api/local/routes";
import { PAIR_CALLBACK_PATH } from "@repo/api/cloud/pairing/pairing-schema";
import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/api/local/connectors/connectors-schema";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "./boot-app";

/** `GET /health` — method and path together, because one path can carry two
 *  methods and either can go missing alone. */
function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * EVERY hand-mounted route, with why it is not a procedure. Adding one is
 * adding a row here, which is the point — the reason is the review.
 */
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

describe("the hand-mounted HTTP surface", () => {
  it("is exactly what the table declares, both directions", async () => {
    const { composed } = await bootTestApp();
    // Middleware registers as `ALL` on the same path it guards, and a wildcard
    // is a mount rather than a route — the RPC prefix is the one of those that
    // IS the surface, so it is declared and the rest are skipped.
    const mounted = new Set(
      composed.app.routes
        .filter((route) => route.method !== "ALL" || route.path === `${RPC_PREFIX}/*`)
        .filter((route) => !route.path.includes("*") || route.path === `${RPC_PREFIX}/*`)
        .map((route) => key(route.method, route.path)),
    );

    const violations: string[] = [];
    for (const route of mounted) {
      if (DECLARED_ROUTES.has(route)) continue;
      violations.push(
        `UNDECLARED ROUTE  ${route}\n` +
          `  rule: a route mounted beside the RPC handler is a deliberate exception to "everything is a procedure"\n` +
          `  fix: add it to DECLARED_ROUTES with the reason it cannot be one — or make it one`,
      );
    }
    for (const [route, why] of DECLARED_ROUTES) {
      if (mounted.has(route)) continue;
      violations.push(
        `UNMOUNTED ROUTE  ${route}\n` +
          `  the row claims: ${why}\n` +
          `  rule: the table states what this server answers; nothing registers this one\n` +
          `  fix: mount it in app.ts, or delete the row`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);

    // A walk that found nothing would satisfy one direction vacuously.
    expect(mounted.size).toBeGreaterThan(0);
    expect(mounted.has(key("GET", HEALTH_PATH))).toBe(true);
  });
});
