import { mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import nodePath from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { createConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/api/local/connectors/connectors-schema";
import {
  BROWSER_HANDOFF_PARAM,
  HEALTH_PATH,
  healthResponseSchema,
  HTML_FRAME_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  WS_PATH,
} from "@repo/api/local/routes";
import {
  browserHandoffResponseSchema,
  guideResponseSchema,
  systemStatusResponseSchema,
} from "@repo/api/local/system/system-schema";
import { serverMessageLenientSchema } from "@repo/api/local/notifications";
import type { ServerMessage } from "@repo/api/local/notifications";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { BROWSER_SESSION_COOKIE } from "../browser-session";
import { HTML_FRAME_DOCUMENT } from "../html-block-frame";
import { closeServer } from "../listen";
import { authorizationHeader } from "../server-file";
import { bootTestApp, listenTestApp, TEST_HOST, TEST_SERVER_TOKEN } from "./boot-app";
import type { BootedTestApp } from "./boot-app";
import { makeTempDir } from "./temp-dir";

// POST: the RPC handler refuses GET for a procedure whose route does not declare one.
const STATUS_RPC_PATH = `${RPC_PREFIX}/system/status`;
const rpcPost = (headers: Record<string, string>): RequestInit => ({
  body: JSON.stringify({ json: {} }),
  headers: { "content-type": "application/json", ...headers },
  method: "POST",
});

const SHELL_HTML = "<!doctype html><html><head><title>inteligir</title></head><body></body></html>";

const makeUi = () => {
  const clientDir = makeTempDir("inteligir-client-test-");
  writeFileSync(nodePath.join(clientDir, "index.html"), SHELL_HTML);
  return { clientDir };
};

// a browser's sign-in as the desktop and `serve --open` drive it: minted over the API, traded on the document.
const signInBrowser = async (booted: BootedTestApp): Promise<string> => {
  const { nonce } = await booted.client.system.browserHandoff();
  const traded = await booted.bareRequest(`/?${BROWSER_HANDOFF_PARAM}=${nonce}`);
  const [pair = ""] = (traded.headers.get("set-cookie") ?? "").split(";");
  return pair.slice(`${BROWSER_SESSION_COOKIE}=`.length);
};

// over a real socket: the upgrade path rebuilds the request on its own, apart from app.request.
const wireUpgradeStatus = async (
  port: number,
  headers: Record<string, string>,
): Promise<number | undefined> => {
  const answered = Promise.withResolvers<number | undefined>();
  const request = httpRequest({
    headers: {
      connection: "Upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      upgrade: "websocket",
      ...headers,
    },
    host: "127.0.0.1",
    path: WS_PATH,
    port,
  });
  request.on("upgrade", () => {
    answered.reject(new Error("upgrade must be refused"));
  });
  request.on("response", (response) => {
    response.resume();
    answered.resolve(response.statusCode);
  });
  request.on("error", (error) => {
    answered.reject(error);
  });
  request.end();
  return await answered.promise;
};

// the socket answers `error` without a reason, so the caller names the one it opened.
const awaitOpen = async (socket: WebSocket, what: string): Promise<void> => {
  const opened: PromiseWithResolvers<void> = Promise.withResolvers();
  socket.addEventListener("open", () => {
    opened.resolve();
  });
  socket.addEventListener("error", () => {
    opened.reject(new Error(what));
  });
  await opened.promise;
};

describe("the API over the in-process app", () => {
  it("answers /health per the contract", async () => {
    const { bareRequest } = await bootTestApp();
    const response = await bareRequest(HEALTH_PATH);
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      ok: true,
    });
  });

  it("answers system.status from the migrated database", async () => {
    const { composed, config, client } = await bootTestApp();
    const status = systemStatusResponseSchema.parse(await client.system.status());
    expect(status.version).toBe("0.1.0-test");
    expect(status.dataDir).toBe(config.dataDir);
    expect(status.vaultDir).toBe(config.vaultDir);
    // not the number: pinning it makes every migration an edit here, and @repo/db's schema-agreement test owns that.
    expect(status.schemaVersion).toBe(composed.context.system.schemaVersion);
    expect(status.schemaVersion).toBeGreaterThan(0);
    expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it("serves the CLI manual on system.guide per the contract", async () => {
    const { client } = await bootTestApp();
    const guide = guideResponseSchema.parse(await client.system.guide());
    expect(guide.markdown).toContain("# The inteligir CLI");
    expect(guide.markdown).toContain("inteligir action wait");
  });

  it("404s unmatched paths when this install ships no UI", async () => {
    const { bareRequest } = await bootTestApp();
    const response = await bareRequest("/nope");
    expect(response.status).toBe(404);
  });

  it("404s an unknown /rpc path, never the SPA shell", async () => {
    const { request } = await bootTestApp({ clientDir: makeUi().clientDir });

    const rpcMiss = await request(`${RPC_PREFIX}/nope`, {
      headers: { accept: "text/html" },
    });
    expect(rpcMiss.status).toBe(404);
    expect(await rpcMiss.text()).not.toContain("<title>inteligir</title>");

    const spaMiss = await request("/some/spa/route", {
      headers: { accept: "text/html" },
    });
    expect(spaMiss.status).toBe(200);
    expect(spaMiss.headers.get("cache-control")).toBe("no-store");
    expect(await spaMiss.text()).toContain("<title>inteligir</title>");
  });

  it("refuses to boot on an un-migrated database — the boot-time schema read throws", () => {
    const dataDir = makeTempDir("inteligir-app-test-");
    const db = createConnection(nodePath.join(dataDir, "inteligir.db"));
    // drizzle names the query in its own error and carries sqlite's underneath as the cause.
    const thrown = ((): Error | undefined => {
      try {
        getSchemaVersion(db, 4);
      } catch (error) {
        return error instanceof Error ? error : undefined;
      }
      return undefined;
    })();
    expect(thrown?.name).toBe("DrizzleQueryError");
    expect(thrown?.cause instanceof Error ? thrown.cause.message : undefined).toMatch(
      /no such table: meta/u,
    );
  });
});

describe("the workspace UI this server ships", () => {
  it("serves hashed assets immutable and 404s an asset miss, never the shell", async () => {
    const { clientDir } = makeUi();
    mkdirSync(nodePath.join(clientDir, "assets"));
    writeFileSync(nodePath.join(clientDir, "assets", "app-abc123.js"), "console.log(1)\n");
    const { bareRequest } = await bootTestApp({ clientDir });

    const hit = await bareRequest("/assets/app-abc123.js");
    expect(hit.status).toBe(200);
    expect(hit.headers.get("content-type")).toContain("text/javascript");
    expect(hit.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await hit.text()).toContain("console.log(1)");

    const miss = await bareRequest("/assets/gone.js", {
      headers: { accept: "text/html" },
    });
    expect(miss.status).toBe(404);
    expect(await miss.text()).not.toContain("<title>inteligir</title>");
  });

  it("mints no handoff on a server with no UI, whose link would land on a 404", async () => {
    const { client } = await bootTestApp();
    const [refused] = await safe(client.system.browserHandoff());
    expect(isDefinedError(refused) && refused.code).toBe("NOT_FOUND");
    expect(refused?.message).toContain("serves no UI");
  });

  it("serves non-asset files no-store and answers every other path with the shell", async () => {
    const { clientDir } = makeUi();
    writeFileSync(nodePath.join(clientDir, "favicon.svg"), "<svg/>");
    const { request } = await bootTestApp({ clientDir });

    const file = await request("/favicon.svg");
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("no-store");

    const document = await request("/", { headers: { accept: "text/html" } });
    expect(document.status).toBe(200);
    expect(document.headers.get("cache-control")).toBe("no-store");
    expect(await document.text()).toContain("<title>inteligir</title>");

    // one answer per URL regardless of Accept: negotiating hands curl and a browser different answers for one path.
    const nonHtml = await request("/some/spa/route");
    expect(nonHtml.status).toBe(200);
    expect(await nonHtml.text()).toContain("<title>inteligir</title>");
  });

  it("stamps the document's security headers, and only on the document", async () => {
    const { clientDir } = makeUi();
    mkdirSync(nodePath.join(clientDir, "assets"));
    writeFileSync(nodePath.join(clientDir, "assets", "app-abc123.js"), "console.log(1)\n");
    const { request } = await bootTestApp({ clientDir });

    const document = await request("/", { headers: { accept: "text/html" } });
    expect(document.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(document.headers.get("content-security-policy")).not.toContain("nonce");
    expect(document.headers.get("x-content-type-options")).toBe("nosniff");
    expect(document.headers.get("referrer-policy")).toBe("no-referrer");

    const asset = await request("/assets/app-abc123.js");
    expect(asset.headers.get("content-security-policy")).toBeNull();
  });

  it("answers a note's html frame under its own sandbox policy, to a tab with no session", async () => {
    const { clientDir } = makeUi();
    const { bareRequest } = await bootTestApp({ clientDir });

    const frame = await bareRequest(HTML_FRAME_PATH);
    expect(frame.status).toBe(200);
    expect(await frame.text()).toBe(HTML_FRAME_DOCUMENT);
    const policy = frame.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("sandbox allow-scripts");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'unsafe-inline'");
    expect(policy).not.toContain("'self'");
  });

  it("refuses traversal out of the client dir", async () => {
    const { clientDir } = makeUi();
    const { bareRequest } = await bootTestApp({ clientDir });
    const traversal = await bareRequest("/assets/..%2f..%2fetc%2fpasswd");
    expect(traversal.status).toBe(404);
  });
});

describe("the device token", () => {
  it("refuses an API request that carries none", async () => {
    const { bareRequest } = await bootTestApp();
    const response = await bareRequest(STATUS_RPC_PATH, rpcPost({}));
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("device token");
    // the renderer tells the gate's 401 from a procedure's UNAUTHORIZED by this challenge alone.
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="inteligir"');
  });

  it("refuses a WRONG token, and accepts each carrier's own secret", async () => {
    const booted = await bootTestApp({ clientDir: makeUi().clientDir });
    const { bareRequest } = booted;

    const wrong = await bareRequest(
      STATUS_RPC_PATH,
      rpcPost({ authorization: authorizationHeader("not-the-token") }),
    );
    expect(wrong.status).toBe(401);

    const bearer = await bareRequest(
      STATUS_RPC_PATH,
      rpcPost({ authorization: authorizationHeader(TEST_SERVER_TOKEN) }),
    );
    expect(bearer.status).toBe(200);

    // the cookie carrier exists for navigations, `<img src>` and `new WebSocket()`, none of which can set a header.
    const secret = await signInBrowser(booted);
    const cookie = await bareRequest(
      STATUS_RPC_PATH,
      rpcPost({
        cookie: `${BROWSER_SESSION_COOKIE}=${secret}`,
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(cookie.status).toBe(200);

    // a cookie reaches every loopback port the browser visits, so it must never be the bearer.
    const bearerAsCookie = await bareRequest(
      STATUS_RPC_PATH,
      rpcPost({
        cookie: `${BROWSER_SESSION_COOKIE}=${TEST_SERVER_TOKEN}`,
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(bearerAsCookie.status).toBe(401);
    const cookieAsBearer = await bareRequest(
      STATUS_RPC_PATH,
      rpcPost({ authorization: authorizationHeader(secret) }),
    );
    expect(cookieAsBearer.status).toBe(401);
  });

  it("REFUSES the cookie from a co-resident cross-port page (SameSite does not isolate ports)", async () => {
    const booted = await bootTestApp({ clientDir: makeUi().clientDir });
    const secret = await signInBrowser(booted);
    const crossPort = await booted.bareRequest(
      STATUS_RPC_PATH,
      rpcPost({
        cookie: `${BROWSER_SESSION_COOKIE}=${secret}`,
        "sec-fetch-site": "same-site",
      }),
    );
    expect(crossPort.status).toBe(403);
  });

  it("leaves /health outside the gate — it is a spawn probe", async () => {
    const { bareRequest } = await bootTestApp();
    const response = await bareRequest(HEALTH_PATH);
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ ok: true });
  });

  it("answers a document request with no session the signed-out page, and no cookie", async () => {
    const { bareRequest } = await bootTestApp({ clientDir: makeUi().clientDir });
    for (const path of ["/", "/settings", `/?note=a.md`]) {
      const document = await bareRequest(path, { headers: { accept: "text/html" } });
      expect(document.status, path).toBe(401);
      expect(document.headers.get("set-cookie"), path).toBeNull();
      expect(document.headers.get("cache-control"), path).toBe("no-store");
      // the page runs nothing, so it is held to the inert policy rather than the app's.
      expect(document.headers.get("content-security-policy"), path).toContain("default-src 'none'");
      const page = await document.text();
      expect(page, path).not.toContain("<title>inteligir</title>");
      expect(page, path).toContain("inteligir open");
    }
  });

  it("serves the shell to a signed-in browser, and the signed-out page to a stale cookie", async () => {
    const booted = await bootTestApp({ clientDir: makeUi().clientDir });
    const secret = await signInBrowser(booted);
    // a top-level navigation: typed, bookmarked or opened by another app, so no same-origin proof.
    const navigation = { accept: "text/html", "sec-fetch-site": "none" };

    const signedIn = await booted.bareRequest("/settings", {
      headers: { ...navigation, cookie: `${BROWSER_SESSION_COOKIE}=${secret}` },
    });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.text()).toContain("<title>inteligir</title>");

    // another boot's secret, as a tab holds after the server restarts.
    const restarted = await bootTestApp({ clientDir: makeUi().clientDir });
    const stale = await restarted.bareRequest("/settings", {
      headers: { ...navigation, cookie: `${BROWSER_SESSION_COOKIE}=${secret}` },
    });
    expect(stale.status).toBe(401);
    expect(await stale.text()).toContain("inteligir open");
  });

  it("lands a spent handoff on the signed-out page rather than the shell", async () => {
    const { bareRequest } = await bootTestApp({ clientDir: makeUi().clientDir });
    const spent = await bareRequest(`/?${BROWSER_HANDOFF_PARAM}=stale`);
    expect(spent.status).toBe(303);
    expect(spent.headers.get("set-cookie")).toBeNull();
    const landed = await bareRequest(spent.headers.get("location") ?? "");
    expect(landed.status).toBe(401);
    expect(await landed.text()).toContain("inteligir open");
  });

  it("trades a handoff minted over the API once for the cookie, then drops it from the URL", async () => {
    const { bareRequest, request } = await bootTestApp({ clientDir: makeUi().clientDir });
    const minted = await request(`${RPC_PREFIX}/system/browserHandoff`, rpcPost({}));
    expect(minted.status).toBe(200);
    const { nonce } = z
      .object({ json: browserHandoffResponseSchema })
      .parse(await minted.json()).json;
    const url = `/settings?note=a+b.md&${BROWSER_HANDOFF_PARAM}=${nonce}`;

    const first = await bareRequest(url);
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe(`http://${TEST_HOST}/settings?note=a+b.md`);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("set-cookie")).toMatch(
      new RegExp(`^${BROWSER_SESSION_COOKIE}=[\\w-]+; HttpOnly; SameSite=Strict; Path=/$`, "u"),
    );

    // a spent link still lands on the page, so a browser that already signed in reloads cleanly.
    const replayed = await bareRequest(url);
    expect(replayed.status).toBe(303);
    expect(replayed.headers.get("location")).toBe(`http://${TEST_HOST}/settings?note=a+b.md`);
    expect(replayed.headers.get("set-cookie")).toBeNull();
  });

  it("keeps a handoff's redirect on this server whatever the path spells", async () => {
    const { bareRequest } = await bootTestApp({ clientDir: makeUi().clientDir });
    const answered = await bareRequest(
      `http://${TEST_HOST}//elsewhere.example/?${BROWSER_HANDOFF_PARAM}=stale`,
    );
    expect(answered.status).toBe(303);
    expect(new URL(answered.headers.get("location") ?? "").host).toBe(TEST_HOST);
  });

  it("gates the websocket upgrade", async () => {
    const { bareRequest } = await bootTestApp();

    const bare = await bareRequest(WS_PATH, { headers: { upgrade: "websocket" } });
    expect(bare.status).toBe(401);

    // authenticated, the upgrade cannot complete in-process; anything but 401 is the gate passing.
    const authed = await bareRequest(WS_PATH, {
      headers: {
        authorization: authorizationHeader(TEST_SERVER_TOKEN),
        upgrade: "websocket",
      },
    });
    expect(authed.status).not.toBe(401);
  });

  it("refuses a real unauthenticated upgrade over the wire", async () => {
    const { port } = await listenTestApp(await bootTestApp());
    expect(await wireUpgradeStatus(port, {})).toBe(401);
  });
});

describe("the host guard", () => {
  const FOREIGN_HOSTS = ["rebound.example:4664", "127.0.0.1.rebound.example"];

  it("refuses a foreign Host on every surface, ahead of the token gate and the cookie", async () => {
    const booted = await bootTestApp({ clientDir: makeUi().clientDir });
    const nonce = booted.composed.context.browserSession.mintHandoff();
    const bearer = authorizationHeader(TEST_SERVER_TOKEN);
    const surfaces: [string, RequestInit][] = [
      ["/", {}],
      [`/?${BROWSER_HANDOFF_PARAM}=${nonce}`, {}],
      [HEALTH_PATH, {}],
      [STATUS_RPC_PATH, rpcPost({ authorization: bearer })],
      [`${VAULT_ASSET_PATH}?path=a.png`, { headers: { authorization: bearer } }],
      [WS_PATH, { headers: { authorization: bearer, upgrade: "websocket" } }],
      [`${CONNECTOR_OAUTH_CALLBACK_PATH}?state=s&code=c`, {}],
      ["/assets/app.js", {}],
    ];
    for (const host of FOREIGN_HOSTS) {
      for (const [path, init] of surfaces) {
        const headers = new Headers(init.headers);
        headers.set("host", host);
        const refused = await booted.bareRequest(path, { ...init, headers });
        expect(refused.status, `${host} ${path}`).toBe(421);
        expect(refused.headers.get("set-cookie"), `${host} ${path}`).toBeNull();
      }
    }
    // the refusal spent nothing: the nonce a foreign name carried still signs in a loopback browser.
    const redeemed = await booted.bareRequest(`/?${BROWSER_HANDOFF_PARAM}=${nonce}`);
    expect(redeemed.headers.get("set-cookie")).not.toBeNull();
  });

  it("refuses a request that names no host at all", async () => {
    const { composed } = await bootTestApp();
    const response = await composed.app.request(HEALTH_PATH);
    expect(response.status).toBe(421);
  });

  it("answers 127.0.0.1 and localhost, on any port", async () => {
    const { bareRequest } = await bootTestApp();
    for (const host of ["127.0.0.1:4664", "localhost:4664", "127.0.0.1:51234", "localhost"]) {
      const health = await bareRequest(HEALTH_PATH, { headers: { host } });
      expect(health.status, host).toBe(200);
    }
  });

  it("refuses a rebound name's websocket upgrade over the wire, bearer and all", async () => {
    const { port } = await listenTestApp(await bootTestApp());
    const status = await wireUpgradeStatus(port, {
      authorization: authorizationHeader(TEST_SERVER_TOKEN),
      host: `rebound.example:${String(port)}`,
    });
    expect(status).toBe(421);
  });
});

describe("the real socket upgrade", () => {
  it("serves the typed client and a live ws round-trip", async () => {
    const booted = await bootTestApp();
    const { bus, config } = booted;
    const { client: wireClient, port } = await listenTestApp(booted);

    const status = await wireClient.system.status();
    expect(status.version).toBe("0.1.0-test");
    expect(status.dataDir).toBe(config.dataDir);

    const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    onTestFinished(() => {
      socket.close();
    });

    const frames: ServerMessage[] = [];
    socket.addEventListener("message", (event) => {
      const text = z.string().safeParse(event.data);
      if (text.success) {
        frames.push(serverMessageLenientSchema.parse(JSON.parse(text.data)));
      }
    });

    const nextFrame = async (): Promise<ServerMessage> =>
      await vi.waitFor(
        () => {
          const frame = frames.shift();
          if (frame === undefined) {
            throw new Error("no ws frame yet");
          }
          return frame;
        },
        { timeout: 5000 },
      );

    await awaitOpen(socket, "ws error");

    const hello = await nextFrame();
    expect(hello).toEqual({ type: "hello" });

    socket.send(JSON.stringify({ target: { kind: "vault" }, type: "subscribe" }));
    // a notification sent before the subscribe lands is dropped, so re-notify on every probe.
    const changed = await vi.waitFor(
      () => {
        bus.notifyDoc("d1", ["content-changed"]);
        const frame = frames.shift();
        if (frame === undefined) {
          throw new Error("no changed frame yet");
        }
        return frame;
      },
      { interval: 25, timeout: 5000 },
    );
    expect(changed).toEqual({
      changes: ["content-changed"],
      entity: "doc",
      id: "d1",
      type: "changed",
    });
  });

  it("closes a bus socket as going-away when the listener tears down", async () => {
    const booted = await bootTestApp();
    const { server, port } = await listenTestApp(booted);
    const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    const closeCode = Promise.withResolvers<number>();
    socket.addEventListener("close", (event) => {
      closeCode.resolve(event.code);
    });
    await awaitOpen(socket, "ws error");

    await closeServer(server, booted.composed.upgradedSockets);
    await expect(closeCode.promise).resolves.toBe(1001);
  });
});
