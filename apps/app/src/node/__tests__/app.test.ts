import { mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { apiErrorResponseSchema } from "@repo/server-contract/errors";
import {
  guideResponseSchema,
  healthResponseSchema,
  systemStatusResponseSchema,
} from "@repo/server-contract/routes";
import { createApiClient } from "@repo/server-contract/client";
import {
  serverMessageLenientSchema,
  type ServerMessage,
} from "@repo/server-contract/notifications";
import {
  VOICE_STREAM_PATH,
  voiceStreamDownMessageSchema,
  type VoiceStreamDownMessage,
} from "@repo/server-contract/voice";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type AppFallback } from "../app";
import { closeServer } from "../listen";
import { authorizationHeader, SERVER_TOKEN_COOKIE, serverTokenCookie } from "../server-file";
import { bootTestApp, TEST_SERVER_TOKEN } from "./boot-app";
import { boundAddressSchema } from "./bound-address";
import { makeTempDir } from "./temp-dir";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  // LIFO: the ws client must close before the server that holds it.
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

/** A prod fallback over a fresh client dir. The fake Start entry ECHOES the
 *  nonce it was handed, which is the whole of what this layer owes it: the
 *  document is the entry's to render, per request, under a nonce the policy
 *  header will name. */
function makeProdFallback() {
  const clientDir = makeTempDir("inteligir-client-test-");
  return {
    clientDir,
    fallback: {
      kind: "prod",
      clientDir,
      startFetch: (_request, options) =>
        Promise.resolve(new Response(`start nonce=${options.context.nonce}`, { status: 200 })),
    } satisfies AppFallback,
  };
}

/** The nonce a policy header names, so a test can hold it against the document
 *  that was rendered under it. */
function policyNonce(response: Response): string {
  const policy = response.headers.get("content-security-policy") ?? "";
  const found = /'nonce-([^']+)'/u.exec(policy);
  if (found?.[1] === undefined) {
    throw new Error(`no nonce in content-security-policy: ${policy}`);
  }
  return found[1];
}

describe("the API over the in-process app", () => {
  it("answers /api/v1/health per the contract", async () => {
    const { composed } = await bootTestApp();
    const response = await composed.app.request("/api/v1/health");
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      ok: true,
    });
  });

  it("answers /api/v1/system/status from the migrated database", async () => {
    const { args, request } = await bootTestApp();
    const response = await request("/api/v1/system/status");
    expect(response.status).toBe(200);
    const status = systemStatusResponseSchema.parse(await response.json());
    expect(status.version).toBe("0.1.0-test");
    expect(status.dataDir).toBe(args.config.dataDir);
    // The instance IDENTITY the CLI's discovery compares against.
    expect(status.vaultDir).toBe(args.config.vaultDir);
    // The point is that migrate-on-boot RAN, not which generation it reached;
    // pinning the number here makes every migration an edit to this suite,
    // and @repo/db's schema-agreement test already owns that pin.
    expect(status.schemaVersion).toBe(args.schemaVersion);
    expect(status.schemaVersion).toBeGreaterThan(0);
    expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it("serves the CLI manual on /api/v1/guide per the contract", async () => {
    const { request } = await bootTestApp();
    const response = await request("/api/v1/guide");
    expect(response.status).toBe(200);
    const guide = guideResponseSchema.parse(await response.json());
    expect(guide.markdown).toContain("# The inteligir CLI");
    expect(guide.markdown).toContain("inteligir action wait");
  });

  it("404s unmatched paths when no UI fallback is mounted", async () => {
    const { composed } = await bootTestApp();
    const response = await composed.app.request("/nope");
    expect(response.status).toBe(404);
  });

  it("answers unmatched /api/v1 paths with JSON 404, never the SPA document", async () => {
    const { composed, request } = await bootTestApp({ fallback: makeProdFallback().fallback });

    const apiMiss = await request("/api/v1/nope", {
      headers: { accept: "text/html" },
    });
    expect(apiMiss.status).toBe(404);
    expect(apiMiss.headers.get("content-type")).toContain("application/json");
    expect(apiErrorResponseSchema.parse(await apiMiss.json()).error).toBe("not_found");

    const spaMiss = await composed.app.request("/some/spa/route", {
      headers: { accept: "text/html" },
    });
    expect(spaMiss.status).toBe(200);
    expect(spaMiss.headers.get("cache-control")).toBe("no-store");
    expect(await spaMiss.text()).toContain("start");
  });

  it("refuses to boot on an un-migrated database — the boot-time schema read throws", () => {
    // The schema version is resolved once at boot (main.ts) and passed into
    // createApp, so a broken schema fails the process loudly instead of
    // surfacing as a 500 per status request.
    const dataDir = makeTempDir("inteligir-app-test-");
    const db = createConnection(join(dataDir, "inteligir.db"));
    expect(() => getSchemaVersion(db, 4)).toThrow(/no such table: meta/);
  });
});

describe("the prod static layer", () => {
  it("serves hashed assets immutable and 404s an asset miss, never the document", async () => {
    const { clientDir, fallback } = makeProdFallback();
    mkdirSync(join(clientDir, "assets"));
    writeFileSync(join(clientDir, "assets", "app-abc123.js"), "console.log(1)\n");
    const { composed } = await bootTestApp({ fallback });

    const hit = await composed.app.request("/assets/app-abc123.js");
    expect(hit.status).toBe(200);
    expect(hit.headers.get("content-type")).toContain("text/javascript");
    expect(hit.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await hit.text()).toContain("console.log(1)");

    const miss = await composed.app.request("/assets/gone.js", {
      headers: { accept: "text/html" },
    });
    expect(miss.status).toBe(404);
    expect(await miss.text()).not.toContain("start");
  });

  it("serves non-asset files no-store and renders every other path as a document", async () => {
    const { clientDir, fallback } = makeProdFallback();
    writeFileSync(join(clientDir, "favicon.svg"), "<svg/>");
    const { composed } = await bootTestApp({ fallback });

    const file = await composed.app.request("/favicon.svg");
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("no-store");

    const document = await composed.app.request("/", { headers: { accept: "text/html" } });
    expect(document.status).toBe(200);
    expect(document.headers.get("cache-control")).toBe("no-store");
    expect(await document.text()).toContain("start");

    // ONE answer per URL, whatever the caller says it accepts. The Accept
    // header used to pick between a prerendered file and the Start entry, so
    // curl and a browser were handed different documents for the same path.
    const nonHtml = await composed.app.request("/some/spa/route");
    expect(nonHtml.status).toBe(200);
    expect(nonHtml.headers.get("cache-control")).toBe("no-store");
    expect(await nonHtml.text()).toContain("start");

    const post = await composed.app.request("/anything", { method: "POST" });
    expect(await post.text()).toContain("start");
  });

  it("renders each document under a FRESH nonce, and names that nonce in its policy", async () => {
    const { fallback } = makeProdFallback();
    const { composed } = await bootTestApp({ fallback });

    const first = await composed.app.request("/", { headers: { accept: "text/html" } });
    const second = await composed.app.request("/", { headers: { accept: "text/html" } });

    // A policy naming a nonce the document does not carry blocks every script
    // on the page, so the two halves are asserted against each other rather
    // than each against a shape.
    expect(await first.text()).toContain(`nonce=${policyNonce(first)}`);
    expect(await second.text()).toContain(`nonce=${policyNonce(second)}`);
    expect(policyNonce(first)).not.toBe(policyNonce(second));
  });

  it("stamps the document's security headers, and only on the document", async () => {
    const { clientDir, fallback } = makeProdFallback();
    mkdirSync(join(clientDir, "assets"));
    writeFileSync(join(clientDir, "assets", "app-abc123.js"), "console.log(1)\n");
    const { composed } = await bootTestApp({ fallback });

    const document = await composed.app.request("/", { headers: { accept: "text/html" } });
    expect(document.headers.get("content-security-policy")).toContain("strict-dynamic");
    expect(document.headers.get("x-content-type-options")).toBe("nosniff");
    expect(document.headers.get("referrer-policy")).toBe("no-referrer");

    // The document is the only response that can execute anything.
    const asset = await composed.app.request("/assets/app-abc123.js");
    expect(asset.headers.get("content-security-policy")).toBeNull();
  });

  it("refuses traversal out of the client dir", async () => {
    const { fallback } = makeProdFallback();
    const { composed } = await bootTestApp({ fallback });
    const traversal = await composed.app.request("/assets/..%2f..%2fetc%2fpasswd");
    expect(traversal.status).toBe(404);
  });
});

describe("the device token", () => {
  it("refuses an API request that carries none", async () => {
    const { composed } = await bootTestApp();
    const response = await composed.app.request("/api/v1/system/status");
    expect(response.status).toBe(401);
    expect(apiErrorResponseSchema.parse(await response.json()).error).toBe("unauthorized");
  });

  it("refuses a WRONG token, and accepts the right one in either carrier", async () => {
    const { composed } = await bootTestApp();

    const wrong = await composed.app.request("/api/v1/system/status", {
      headers: { authorization: authorizationHeader("not-the-token") },
    });
    expect(wrong.status).toBe(401);

    const bearer = await composed.app.request("/api/v1/system/status", {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    expect(bearer.status).toBe(200);

    // The browser's carrier: a document navigation, an `<img src>` and a
    // `new WebSocket()` can none of them set a header.
    const cookie = await composed.app.request("/api/v1/system/status", {
      headers: { cookie: `${SERVER_TOKEN_COOKIE}=${TEST_SERVER_TOKEN}` },
    });
    expect(cookie.status).toBe(200);
  });

  it("leaves /health outside the gate — it is a spawn probe", async () => {
    const { composed } = await bootTestApp();
    const response = await composed.app.request("/api/v1/health");
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ ok: true });
  });

  it("hands the browser its credential on the document, HttpOnly and SameSite=Strict", async () => {
    const { fallback } = makeProdFallback();
    const { composed } = await bootTestApp({ fallback });
    const document = await composed.app.request("/", { headers: { accept: "text/html" } });
    expect(document.headers.get("set-cookie")).toBe(serverTokenCookie(TEST_SERVER_TOKEN));
  });

  it("gates both websocket upgrades", async () => {
    const { composed } = await bootTestApp();

    for (const path of ["/ws", VOICE_STREAM_PATH]) {
      const bare = await composed.app.request(path, { headers: { upgrade: "websocket" } });
      expect(bare.status).toBe(401);

      // Authenticated, the request reaches the upgrade machinery (which cannot
      // complete in-process — anything but a 401 is the gate passing).
      const authed = await composed.app.request(path, {
        headers: {
          upgrade: "websocket",
          authorization: authorizationHeader(TEST_SERVER_TOKEN),
        },
      });
      expect(authed.status).not.toBe(401);
    }
  });

  it("refuses a real unauthenticated upgrade over the wire", async () => {
    const { composed } = await bootTestApp();
    const server = serve({ fetch: composed.app.fetch, hostname: "127.0.0.1", port: 0 });
    composed.injectWebSocket(server);
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    );
    if (server.address() === null) {
      await new Promise<void>((resolve) => server.once("listening", resolve));
    }
    const address = boundAddressSchema.parse(server.address());

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        path: "/ws",
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-version": "13",
        },
      });
      request.on("upgrade", () => reject(new Error("upgrade must be refused")));
      request.on("response", (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", reject);
      request.end();
    });
    expect(status).toBe(401);
  });
});

describe("the real socket upgrade", () => {
  it("serves the typed client and a live ws round-trip", async () => {
    const { args, composed } = await bootTestApp();

    const server = serve({
      fetch: composed.app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });
    composed.injectWebSocket(server);
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    );

    if (server.address() === null) {
      await new Promise<void>((resolve) => server.once("listening", resolve));
    }
    const address = boundAddressSchema.parse(server.address());
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // The typed hc client against the live server — contract → handler → client.
    const client = createApiClient(baseUrl, {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("authorization", authorizationHeader(TEST_SERVER_TOKEN));
        return fetch(input, { ...init, headers });
      },
    });
    const healthResponse = await client.health.$get();
    expect(healthResponse.status).toBe(200);
    expect(healthResponseSchema.parse(await healthResponse.json())).toEqual({
      ok: true,
    });

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    cleanups.push(() => socket.close());

    const frames: ServerMessage[] = [];
    let announceFrame: (() => void) | undefined;
    socket.addEventListener("message", (event) => {
      const text = z.string().safeParse(event.data);
      if (text.success) {
        frames.push(serverMessageLenientSchema.parse(JSON.parse(text.data)));
      }
      announceFrame?.();
    });

    async function nextFrame(): Promise<ServerMessage> {
      const deadline = Date.now() + 5_000;
      while (frames.length === 0) {
        if (Date.now() > deadline) {
          throw new Error("timed out waiting for a ws frame");
        }
        await new Promise<void>((resolve) => {
          announceFrame = resolve;
          setTimeout(resolve, 50);
        });
      }
      const frame = frames.shift();
      if (frame === undefined) {
        throw new Error("timed out waiting for a ws frame");
      }
      return frame;
    }

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("ws error")));
    });

    const hello = await nextFrame();
    expect(hello).toEqual({ type: "hello", version: "0.1.0-test" });

    socket.send(JSON.stringify({ type: "subscribe", target: { kind: "doc-detail", docId: "d1" } }));
    // Subscription is processed on receipt; poll until the broadcast lands.
    const deadline = Date.now() + 5_000;
    let changed: ServerMessage | undefined;
    while (changed === undefined) {
      if (Date.now() > deadline) {
        throw new Error("timed out waiting for the changed frame");
      }
      args.bus.notifyDoc("d1", ["content-changed"]);
      if (frames.length > 0) {
        changed = frames.shift();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(changed).toEqual({
      type: "changed",
      entity: "doc",
      id: "d1",
      changes: ["content-changed"],
    });
  });
});

async function serveVoiceApp() {
  const booted = await bootTestApp();
  const server = serve({ fetch: booted.composed.app.fetch, hostname: "127.0.0.1", port: 0 });
  booted.composed.injectWebSocket(server);
  if (server.address() === null) {
    await new Promise<void>((resolve) => server.once("listening", resolve));
  }
  const address = boundAddressSchema.parse(server.address());
  return { booted, server, port: address.port };
}

function closeServerOnce(server: ReturnType<typeof serve>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("the dictation stream socket", () => {
  it("streams a scripted partial and a final over the socket, then closes", async () => {
    const { server, port } = await serveVoiceApp();
    cleanups.push(() => closeServerOnce(server));

    const socket = new WebSocket(`ws://127.0.0.1:${port}${VOICE_STREAM_PATH}`, {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    socket.binaryType = "arraybuffer";
    const frames: VoiceStreamDownMessage[] = [];
    let announce: (() => void) | undefined;
    socket.addEventListener("message", (event) => {
      const text = z.string().safeParse(event.data);
      if (text.success) {
        frames.push(voiceStreamDownMessageSchema.parse(JSON.parse(text.data)));
      }
      announce?.();
    });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("voice ws error")));
    });

    // Two 16-bit samples up, then finalize — the scripted session names the count.
    socket.send(new Uint8Array([1, 0, 2, 0]).buffer);
    socket.send(JSON.stringify({ type: "finalize" }));

    const deadline = Date.now() + 5_000;
    while (!frames.some((frame) => frame.type === "final")) {
      if (Date.now() > deadline) {
        throw new Error(`no final; frames: ${JSON.stringify(frames)}`);
      }
      await new Promise<void>((resolve) => {
        announce = resolve;
        setTimeout(resolve, 50);
      });
    }

    const partial = frames.find((frame) => frame.type === "partial");
    const final = frames.find((frame) => frame.type === "final");
    expect(partial?.type === "partial" ? partial.text : "").toBe("scripted dictation of 2 samples");
    expect(final?.type === "final" ? final.text : "").toBe("scripted dictation of 2 samples");
  });

  it("does not stall teardown while a dictation socket is open", async () => {
    const { booted, server, port } = await serveVoiceApp();

    const socket = new WebSocket(`ws://127.0.0.1:${port}${VOICE_STREAM_PATH}`, {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("voice ws error")));
    });
    // Keep it open (mid-hold): a frame up, no finalize.
    socket.send(new Uint8Array([1, 0]).buffer);

    // The listener teardown closes the voice socket BY NAME, so this resolves
    // rather than hanging on a hijacked connection the server cannot see.
    await closeServer(server, {
      closeAllClients: () => booted.composed.voiceStreamHub.closeAllClients(),
      terminateAllClients: () => booted.composed.voiceStreamHub.terminateAllClients(),
    });
    socket.close();
  });
});
