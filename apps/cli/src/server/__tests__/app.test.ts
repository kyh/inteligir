import { mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import nodePath from "node:path";
import { createConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import {
  HEALTH_PATH,
  healthResponseSchema,
  RPC_PREFIX,
  VOICE_STREAM_PATH,
  WS_PATH,
} from "@repo/api/local/routes";
import {
  guideResponseSchema,
  systemStatusResponseSchema,
} from "@repo/api/local/system/system-schema";
import { serverMessageLenientSchema } from "@repo/api/local/notifications";
import type { ServerMessage } from "@repo/api/local/notifications";
import { voiceStreamDownMessageSchema } from "@repo/api/local/voice/voice-schema";
import type { VoiceStreamDownMessage } from "@repo/api/local/voice/voice-schema";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { closeServer } from "../listen";
import { authorizationHeader, SERVER_TOKEN_COOKIE, serverTokenCookie } from "../server-file";
import { bootTestApp, listenTestApp, TEST_SERVER_TOKEN } from "./boot-app";
import { makeTempDir } from "./temp-dir";

// POST: the RPC handler refuses GET for a procedure whose route does not declare one.
const STATUS_RPC_PATH = `${RPC_PREFIX}/system/status`;
const statusRpcRequest = (headers: Record<string, string>): RequestInit => ({
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
    const { composed } = await bootTestApp();
    const response = await composed.app.request(HEALTH_PATH);
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
    const { composed } = await bootTestApp();
    const response = await composed.app.request("/nope");
    expect(response.status).toBe(404);
  });

  it("404s an unknown /rpc path, never the SPA shell", async () => {
    const { composed, request } = await bootTestApp({ clientDir: makeUi().clientDir });

    const rpcMiss = await request(`${RPC_PREFIX}/nope`, {
      headers: { accept: "text/html" },
    });
    expect(rpcMiss.status).toBe(404);
    expect(await rpcMiss.text()).not.toContain("<title>inteligir</title>");

    const spaMiss = await composed.app.request("/some/spa/route", {
      headers: { accept: "text/html" },
    });
    expect(spaMiss.status).toBe(200);
    expect(spaMiss.headers.get("cache-control")).toBe("no-store");
    expect(await spaMiss.text()).toContain("<title>inteligir</title>");
  });

  it("refuses to boot on an un-migrated database — the boot-time schema read throws", () => {
    const dataDir = makeTempDir("inteligir-app-test-");
    const db = createConnection(nodePath.join(dataDir, "inteligir.db"));
    expect(() => getSchemaVersion(db, 4)).toThrow(/no such table: meta/u);
  });
});

describe("the workspace UI this server ships", () => {
  it("serves hashed assets immutable and 404s an asset miss, never the shell", async () => {
    const { clientDir } = makeUi();
    mkdirSync(nodePath.join(clientDir, "assets"));
    writeFileSync(nodePath.join(clientDir, "assets", "app-abc123.js"), "console.log(1)\n");
    const { composed } = await bootTestApp({ clientDir });

    const hit = await composed.app.request("/assets/app-abc123.js");
    expect(hit.status).toBe(200);
    expect(hit.headers.get("content-type")).toContain("text/javascript");
    expect(hit.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await hit.text()).toContain("console.log(1)");

    const miss = await composed.app.request("/assets/gone.js", {
      headers: { accept: "text/html" },
    });
    expect(miss.status).toBe(404);
    expect(await miss.text()).not.toContain("<title>inteligir</title>");
  });

  it("serves non-asset files no-store and answers every other path with the shell", async () => {
    const { clientDir } = makeUi();
    writeFileSync(nodePath.join(clientDir, "favicon.svg"), "<svg/>");
    const { composed } = await bootTestApp({ clientDir });

    const file = await composed.app.request("/favicon.svg");
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("no-store");

    const document = await composed.app.request("/", { headers: { accept: "text/html" } });
    expect(document.status).toBe(200);
    expect(document.headers.get("cache-control")).toBe("no-store");
    expect(await document.text()).toContain("<title>inteligir</title>");

    // one answer per URL regardless of Accept: negotiating hands curl and a browser different answers for one path.
    const nonHtml = await composed.app.request("/some/spa/route");
    expect(nonHtml.status).toBe(200);
    expect(await nonHtml.text()).toContain("<title>inteligir</title>");
  });

  it("stamps the document's security headers, and only on the document", async () => {
    const { clientDir } = makeUi();
    mkdirSync(nodePath.join(clientDir, "assets"));
    writeFileSync(nodePath.join(clientDir, "assets", "app-abc123.js"), "console.log(1)\n");
    const { composed } = await bootTestApp({ clientDir });

    const document = await composed.app.request("/", { headers: { accept: "text/html" } });
    expect(document.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(document.headers.get("content-security-policy")).not.toContain("nonce");
    expect(document.headers.get("x-content-type-options")).toBe("nosniff");
    expect(document.headers.get("referrer-policy")).toBe("no-referrer");

    const asset = await composed.app.request("/assets/app-abc123.js");
    expect(asset.headers.get("content-security-policy")).toBeNull();
  });

  it("refuses traversal out of the client dir", async () => {
    const { clientDir } = makeUi();
    const { composed } = await bootTestApp({ clientDir });
    const traversal = await composed.app.request("/assets/..%2f..%2fetc%2fpasswd");
    expect(traversal.status).toBe(404);
  });
});

describe("the device token", () => {
  it("refuses an API request that carries none", async () => {
    const { composed } = await bootTestApp();
    const response = await composed.app.request(STATUS_RPC_PATH, statusRpcRequest({}));
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("device token");
  });

  it("refuses a WRONG token, and accepts the right one in either carrier", async () => {
    const { composed } = await bootTestApp();

    const wrong = await composed.app.request(
      STATUS_RPC_PATH,
      statusRpcRequest({ authorization: authorizationHeader("not-the-token") }),
    );
    expect(wrong.status).toBe(401);

    const bearer = await composed.app.request(
      STATUS_RPC_PATH,
      statusRpcRequest({ authorization: authorizationHeader(TEST_SERVER_TOKEN) }),
    );
    expect(bearer.status).toBe(200);

    // the cookie carrier exists for navigations, `<img src>` and `new WebSocket()`, none of which can set a header.
    const cookie = await composed.app.request(
      STATUS_RPC_PATH,
      statusRpcRequest({
        cookie: `${SERVER_TOKEN_COOKIE}=${TEST_SERVER_TOKEN}`,
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(cookie.status).toBe(200);
  });

  it("REFUSES the cookie from a co-resident cross-port page (SameSite does not isolate ports)", async () => {
    const { composed } = await bootTestApp();
    const crossPort = await composed.app.request(
      STATUS_RPC_PATH,
      statusRpcRequest({
        cookie: `${SERVER_TOKEN_COOKIE}=${TEST_SERVER_TOKEN}`,
        "sec-fetch-site": "same-site",
      }),
    );
    expect(crossPort.status).toBe(403);
  });

  it("leaves /health outside the gate — it is a spawn probe", async () => {
    const { composed } = await bootTestApp();
    const response = await composed.app.request(HEALTH_PATH);
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ ok: true });
  });

  it("hands the browser its credential on the document, HttpOnly and SameSite=Strict", async () => {
    const { clientDir } = makeUi();
    const { composed } = await bootTestApp({ clientDir });
    const document = await composed.app.request("/", { headers: { accept: "text/html" } });
    expect(document.headers.get("set-cookie")).toBe(serverTokenCookie(TEST_SERVER_TOKEN));
  });

  it("gates both websocket upgrades", async () => {
    const { composed } = await bootTestApp();

    for (const path of [WS_PATH, VOICE_STREAM_PATH]) {
      const bare = await composed.app.request(path, { headers: { upgrade: "websocket" } });
      expect(bare.status).toBe(401);

      // authenticated, the upgrade cannot complete in-process; anything but 401 is the gate passing.
      const authed = await composed.app.request(path, {
        headers: {
          authorization: authorizationHeader(TEST_SERVER_TOKEN),
          upgrade: "websocket",
        },
      });
      expect(authed.status).not.toBe(401);
    }
  });

  it("refuses a real unauthenticated upgrade over the wire", async () => {
    const { port } = await listenTestApp(await bootTestApp());

    const answered = Promise.withResolvers<number | undefined>();
    const request = httpRequest({
      headers: {
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        upgrade: "websocket",
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
    expect(await answered.promise).toBe(401);
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
});

describe("the dictation stream socket", () => {
  it("streams a scripted partial and a final over the socket, then closes", async () => {
    const { port } = await listenTestApp(await bootTestApp());

    const socket = new WebSocket(`ws://127.0.0.1:${port}${VOICE_STREAM_PATH}`, {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    socket.binaryType = "arraybuffer";
    const frames: VoiceStreamDownMessage[] = [];
    socket.addEventListener("message", (event) => {
      const text = z.string().safeParse(event.data);
      if (text.success) {
        frames.push(voiceStreamDownMessageSchema.parse(JSON.parse(text.data)));
      }
    });
    await awaitOpen(socket, "voice ws error");

    // two 16-bit samples up, then finalize; the scripted session names the count.
    socket.send(new Uint8Array([1, 0, 2, 0]).buffer);
    socket.send(JSON.stringify({ type: "finalize" }));

    await vi.waitFor(
      () => {
        expect(frames.map((frame) => frame.type)).toContain("final");
      },
      {
        timeout: 5000,
      },
    );

    const partial = frames.find((frame) => frame.type === "partial");
    const final = frames.find((frame) => frame.type === "final");
    expect(partial?.type === "partial" ? partial.text : "").toBe("scripted dictation of 2 samples");
    expect(final?.type === "final" ? final.text : "").toBe("scripted dictation of 2 samples");
  });

  it("does not stall teardown while a dictation socket is open", async () => {
    const booted = await bootTestApp();
    const { server, port } = await listenTestApp(booted);

    const socket = new WebSocket(`ws://127.0.0.1:${port}${VOICE_STREAM_PATH}`, {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    await awaitOpen(socket, "voice ws error");
    // keep it open (mid-hold): a frame up, no finalize.
    socket.send(new Uint8Array([1, 0]).buffer);

    await closeServer(server, {
      closeAllClients: () => {
        booted.composed.voiceStreamHub.closeAllClients();
      },
      terminateAllClients: () => {
        booted.composed.voiceStreamHub.terminateAllClients();
      },
    });
    socket.close();
  });
});
