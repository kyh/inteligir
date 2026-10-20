import {
  BROWSER_HANDOFF_PARAM,
  HEALTH_PATH,
  HTML_FRAME_PATH,
  MEDIA_TOKEN_PARAM,
  PAGE_COPY_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  VAULT_THUMB_PATH,
  WS_PATH,
} from "@repo/contract/local/routes";
import { mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_SESSION_COOKIE } from "./browser-session";
import { bootTestApp } from "./test-support/boot-app";
import { makeTempDir } from "./test-support/temp-dir";

const key = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;

const DECLARED_ROUTES = new Map<string, string>([
  [
    key("ALL", `${RPC_PREFIX}/*`),
    "the RPC handler itself — every procedure in the contract arrives here",
  ],
  [
    key("GET", HEALTH_PATH),
    "the boot probe the smokes and the e2e harness wait on before they read a credential, so it is the one route outside the token gate",
  ],
  [
    key("GET", VAULT_ASSET_PATH),
    "a file's raw BYTES, with an ETag and a 304 on if-none-match — none of which survives an RPC envelope",
  ],
  [key("GET", PAGE_COPY_PATH), "its body is bytes with its own CSP"],
  [key("GET", VAULT_THUMB_PATH), "its body is bytes with its own CSP"],
  [key("GET", WS_PATH), "the invalidation bus: subscribe and ping, no payload, by decision"],
]);

// per method: `serveStatic` mounts GET and HEAD separately.
const DECLARED_BUNDLE_ROUTES = new Map<string, string>([
  [
    key("GET", HTML_FRAME_PATH),
    "the document a note's html block runs in: public bytes like the shell, under a sandbox policy of its own, since a srcdoc frame inherits the page's `script-src 'self'` and runs no inline script",
  ],
  ...["GET", "HEAD"].flatMap((method) => [
    [
      key(method, "/assets/*"),
      "the built bundle's hashed files, the only ones that may be immutable — and a miss must 404 rather than answer the shell, which would hand the module loader HTML",
    ] as const,
    [
      key(method, "/*"),
      "ONE answer per URL and it is the shell: the router reads the URL client-side, so every deep link is the same document",
    ] as const,
  ]),
]);

// middleware on every path that answers only to refuse, so it is no surface of its own. its whole
// claim is that it runs before any route, and hono runs handlers in registration order.
const HOST_GUARD = key("ALL", "/*");

const stagedBundle = (): string => {
  const clientDir = makeTempDir("inteligir-http-surface-");
  mkdirSync(nodePath.join(clientDir, "assets"), { recursive: true });
  writeFileSync(nodePath.join(clientDir, "index.html"), "<!doctype html><title>inteligir</title>");
  return clientDir;
};

// `app.use` middleware registers as ALL on the path it guards, so ALL is dropped except the RPC mount.
const mountedRoutes = (routes: readonly { method: string; path: string }[]): Set<string> =>
  new Set(
    routes
      .filter((route) => route.method !== "ALL" || route.path === `${RPC_PREFIX}/*`)
      .map((route) => key(route.method, route.path)),
  );

describe.each([
  { extra: new Map<string, string>(), mode: "without a bundle", staged: false },
  { extra: DECLARED_BUNDLE_ROUTES, mode: "serving the bundle", staged: true },
])("the hand-mounted HTTP surface, $mode", ({ staged, extra }) => {
  const declared = new Map([...DECLARED_ROUTES, ...extra]);

  it("is exactly what the table declares, both directions", async () => {
    const options = staged ? { clientDir: stagedBundle() } : {};
    const { composed } = await bootTestApp(options);
    const mounted = mountedRoutes(composed.app.routes);

    const violations: string[] = [];
    for (const route of mounted) {
      if (declared.has(route)) {
        continue;
      }
      violations.push(
        `UNDECLARED ROUTE  ${route}\n` +
          `  rule: a route mounted beside the RPC handler is a deliberate exception to "everything is a procedure"\n` +
          `  fix: add it to DECLARED_ROUTES with the reason it cannot be one — or make it one`,
      );
    }
    for (const [route, why] of declared) {
      if (mounted.has(route)) {
        continue;
      }
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
      if (route.method !== "ALL" || route.path === `${RPC_PREFIX}/*`) {
        continue;
      }
      if (nonAllPaths.has(route.path) || key(route.method, route.path) === HOST_GUARD) {
        continue;
      }
      violations.push(
        `REACHABLE ALL ROUTE  ALL ${route.path}\n` +
          `  rule: an ALL registration is dropped as middleware only when a non-ALL route on the same path proves it guards something; this one guards nothing declared\n` +
          `  fix: declare it as a real route, or make it a procedure — an untyped ALL surface is exactly what this guard exists to catch`,
      );
    }

    const [first] = composed.app.routes;
    if (first === undefined || key(first.method, first.path) !== HOST_GUARD) {
      violations.push(
        `UNGUARDED SURFACE  the first registration is ${first === undefined ? "nothing" : key(first.method, first.path)}\n` +
          `  rule: a request naming any host but 127.0.0.1 or localhost is refused before a route runs\n` +
          `  fix: register the host guard in app.ts ahead of every route`,
      );
    }

    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);

    // a walk that found nothing would satisfy one direction vacuously.
    expect(mounted.size).toBeGreaterThan(0);
    expect(mounted.has(key("GET", HEALTH_PATH))).toBe(true);
  });
});

// the byte routes, the only ones that read the boot's media token: AVFoundation's loader inside
// WKWebView may send a video's range requests with neither Sec-Fetch-Site nor Origin.
const MEDIA_ROUTES = [
  `${VAULT_ASSET_PATH}?path=clip.png`,
  `${PAGE_COPY_PATH}?path=${encodeURIComponent("assets/pages/0123456789abcdef.html")}`,
  `${VAULT_THUMB_PATH}?path=clip.png&w=320`,
];

// past the gate, whatever the handler then answers for the file
const REFUSED_AT_THE_GATE = [401, 403];

// every other route a browser's cookie reaches, which must keep refusing a header-less request:
// the procedures and the invalidation bus's socket
const COOKIE_ROUTES: { init: RequestInit; path: string }[] = [
  {
    init: { body: JSON.stringify({ json: {} }), method: "POST" },
    path: `${RPC_PREFIX}/system/status`,
  },
  { init: { method: "GET" }, path: WS_PATH },
];

const signedIn = async () => {
  const booted = await bootTestApp({ clientDir: stagedBundle() });
  await writeFile(nodePath.join(booted.vaultDir, "clip.png"), "png-bytes", "utf-8");
  const { nonce } = await booted.client.system.browserHandoff();
  const traded = await booted.bareRequest(`/?${BROWSER_HANDOFF_PARAM}=${nonce}`);
  const [cookie = ""] = (traded.headers.get("set-cookie") ?? "").split(";");
  const { mediaToken } = await booted.client.system.status();
  const statusOf = async (url: string, init?: RequestInit): Promise<number> => {
    const response = await booted.bareRequest(url, init);
    return response.status;
  };
  return { cookie, mediaToken, statusOf };
};

describe("the media token", () => {
  it("lets a byte route take a header-less cookie request that names it, and only that", async () => {
    const { cookie, mediaToken, statusOf } = await signedIn();
    for (const route of MEDIA_ROUTES) {
      const named = `${route}&${MEDIA_TOKEN_PARAM}=${encodeURIComponent(mediaToken)}`;
      expect(REFUSED_AT_THE_GATE, route).not.toContain(
        await statusOf(named, { headers: { cookie } }),
      );
      expect(await statusOf(route, { headers: { cookie } }), route).toBe(403);
      const wrong = `${route}&${MEDIA_TOKEN_PARAM}=not-the-token`;
      expect(await statusOf(wrong, { headers: { cookie } }), route).toBe(403);
      // the token is no credential: without the cookie it is refused like any request
      expect(await statusOf(named), route).toBe(401);
      const sameOrigin = { cookie, "sec-fetch-site": "same-origin" };
      expect(REFUSED_AT_THE_GATE, route).not.toContain(
        await statusOf(route, { headers: sameOrigin }),
      );
    }
    const [asset = ""] = MEDIA_ROUTES;
    const named = `${asset}&${MEDIA_TOKEN_PARAM}=${encodeURIComponent(mediaToken)}`;
    expect(await statusOf(named, { headers: { cookie } })).toBe(200);
  });

  it("is read by no other route: a header-less cookie request stays refused there", async () => {
    const { cookie, mediaToken, statusOf } = await signedIn();
    for (const { path, init } of COOKIE_ROUTES) {
      const named = `${path}?${MEDIA_TOKEN_PARAM}=${encodeURIComponent(mediaToken)}`;
      const headers = { "content-type": "application/json", cookie };
      expect(await statusOf(named, { ...init, headers }), path).toBe(403);
    }
  });

  it("is minted per boot, apart from the cookie's secret", async () => {
    const first = await signedIn();
    const second = await signedIn();
    expect(first.mediaToken).not.toBe(second.mediaToken);
    expect(first.cookie).not.toContain(first.mediaToken);
    expect(first.cookie.startsWith(`${BROWSER_SESSION_COOKIE}=`)).toBe(true);
  });
});
