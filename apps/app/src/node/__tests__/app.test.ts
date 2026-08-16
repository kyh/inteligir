import { mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  systemStatusResponseSchema,
} from "@repo/server-contract/routes";
import { createApiClient } from "@repo/server-contract/client";
import { serverMessageLenientSchema } from "@repo/server-contract/notifications";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type AppFallback, type CreateAppArgs } from "../app";
import { WsBus } from "../ws-bus";
import { makeTempDir } from "./temp-dir";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  // LIFO: the ws client must close before the server that holds it.
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

interface BootAppOptions {
  fallback?: AppFallback;
  port?: number;
}

function bootApp(options: BootAppOptions = {}): {
  args: CreateAppArgs;
  composed: ReturnType<typeof createApp>;
} {
  const dataDir = makeTempDir("inteligir-app-test-");
  const databasePath = join(dataDir, "inteligir.db");
  const db = createConnection(databasePath);
  runMigrations(db);
  const args: CreateAppArgs = {
    bus: new WsBus({ version: "0.1.0-test" }),
    config: {
      databasePath,
      dataDir,
      dataDirSource: "env",
      mode: "dev",
      port: options.port ?? 0,
      portSource: "env",
    },
    fallback: options.fallback ?? { kind: "none" },
    schemaVersion: getSchemaVersion(db),
    startedAt: Date.now(),
    version: "0.1.0-test",
  };
  return { args, composed: createApp(args) };
}

/** A prod fallback over a fresh client dir holding the shell and one asset. */
function makeProdFallback(): { clientDir: string; fallback: AppFallback } {
  const clientDir = makeTempDir("inteligir-client-test-");
  writeFileSync(join(clientDir, "_shell.html"), "<!doctype html><title>shell</title>");
  return {
    clientDir,
    fallback: {
      kind: "prod",
      clientDir,
      startFetch: () => Promise.resolve(new Response("start", { status: 200 })),
    },
  };
}

describe("the API over the in-process app", () => {
  it("answers /api/v1/health per the contract", async () => {
    const { composed } = bootApp();
    const response = await composed.app.request("/api/v1/health");
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      ok: true,
    });
  });

  it("answers /api/v1/system/status from the migrated database", async () => {
    const { args, composed } = bootApp();
    const response = await composed.app.request("/api/v1/system/status");
    expect(response.status).toBe(200);
    const status = systemStatusResponseSchema.parse(await response.json());
    expect(status.version).toBe("0.1.0-test");
    expect(status.dataDir).toBe(args.config.dataDir);
    expect(status.schemaVersion).toBe(1);
    expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it("404s unmatched paths when no UI fallback is mounted", async () => {
    const { composed } = bootApp();
    const response = await composed.app.request("/nope");
    expect(response.status).toBe(404);
  });

  it("answers unmatched /api/v1 paths with JSON 404, never the SPA shell", async () => {
    const { composed } = bootApp({ fallback: makeProdFallback().fallback });

    const apiMiss = await composed.app.request("/api/v1/nope", {
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
    expect(await spaMiss.text()).toContain("shell");
  });

  it("refuses to boot on an un-migrated database — the boot-time schema read throws", () => {
    // The schema version is resolved once at boot (main.ts) and passed into
    // createApp, so a broken schema fails the process loudly instead of
    // surfacing as a 500 per status request.
    const dataDir = makeTempDir("inteligir-app-test-");
    const db = createConnection(join(dataDir, "inteligir.db"));
    expect(() => getSchemaVersion(db)).toThrow(/no such table: meta/);
  });
});

describe("the prod static layer", () => {
  it("serves hashed assets immutable and 404s an asset miss, never the shell", async () => {
    const { clientDir, fallback } = makeProdFallback();
    mkdirSync(join(clientDir, "assets"));
    writeFileSync(join(clientDir, "assets", "app-abc123.js"), "console.log(1)\n");
    const { composed } = bootApp({ fallback });

    const hit = await composed.app.request("/assets/app-abc123.js");
    expect(hit.status).toBe(200);
    expect(hit.headers.get("content-type")).toContain("text/javascript");
    expect(hit.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await hit.text()).toContain("console.log(1)");

    const miss = await composed.app.request("/assets/gone.js", {
      headers: { accept: "text/html" },
    });
    expect(miss.status).toBe(404);
    expect(await miss.text()).not.toContain("shell");
  });

  it("serves non-asset files no-store and hands non-HTML misses to the Start entry", async () => {
    const { clientDir, fallback } = makeProdFallback();
    writeFileSync(join(clientDir, "favicon.svg"), "<svg/>");
    const { composed } = bootApp({ fallback });

    const file = await composed.app.request("/favicon.svg");
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("no-store");

    const shell = await composed.app.request("/", { headers: { accept: "text/html" } });
    expect(shell.status).toBe(200);
    expect(shell.headers.get("cache-control")).toBe("no-store");
    expect(await shell.text()).toContain("shell");

    // A non-HTML miss and a non-GET both reach the Start entry untouched —
    // no cache-control stamped onto its responses.
    const startMiss = await composed.app.request("/api-docs.json");
    expect(await startMiss.text()).toBe("start");
    expect(startMiss.headers.get("cache-control")).toBeNull();

    const post = await composed.app.request("/anything", { method: "POST" });
    expect(await post.text()).toBe("start");
  });

  it("refuses traversal out of the client dir", async () => {
    const { fallback } = makeProdFallback();
    const { composed } = bootApp({ fallback });
    const traversal = await composed.app.request("/assets/..%2f..%2fetc%2fpasswd");
    expect(traversal.status).toBe(404);
  });
});

describe("the browser-origin guard", () => {
  it("refuses a foreign Origin on the API", async () => {
    const { composed } = bootApp();
    const response = await composed.app.request("/api/v1/health", {
      headers: { origin: "http://evil.example" },
    });
    expect(response.status).toBe(403);
    expect(apiErrorResponseSchema.parse(await response.json()).error).toBe("forbidden_origin");
  });

  it("passes Origin-less callers and the app's own origins", async () => {
    const { composed } = bootApp({ port: 4664 });

    const originless = await composed.app.request("/api/v1/health");
    expect(originless.status).toBe(200);

    const configured = await composed.app.request("/api/v1/health", {
      headers: { origin: "http://127.0.0.1:4664" },
    });
    expect(configured.status).toBe(200);

    const localhostVariant = await composed.app.request("/api/v1/health", {
      headers: { origin: "http://localhost:4664" },
    });
    expect(localhostVariant.status).toBe(200);

    // The server may bind a probed port: the origin matching the request's
    // own loopback Host target is the app's own origin too.
    const probedPort = await composed.app.request("/api/v1/health", {
      headers: { host: "127.0.0.1:24911", origin: "http://127.0.0.1:24911" },
    });
    expect(probedPort.status).toBe(200);

    // A foreign Origin never rides in on a matching-looking Host.
    const foreignHost = await composed.app.request("/api/v1/health", {
      headers: { host: "evil.example:4664", origin: "http://evil.example:4664" },
    });
    expect(foreignHost.status).toBe(403);
  });

  it("refuses the ws upgrade for a foreign Origin", async () => {
    const { composed } = bootApp({ port: 4664 });

    const foreign = await composed.app.request("/ws", {
      headers: { origin: "http://evil.example", upgrade: "websocket" },
    });
    expect(foreign.status).toBe(403);

    // Own origin passes the guard and reaches the upgrade machinery (which
    // cannot complete in-process — anything but a 403 is the guard passing).
    const own = await composed.app.request("/ws", {
      headers: { origin: "http://127.0.0.1:4664", upgrade: "websocket" },
    });
    expect(own.status).not.toBe(403);
  });

  it("refuses a real upgrade over the wire for a foreign Origin", async () => {
    const { composed } = bootApp();
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
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a bound AddressInfo");
    }

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        path: "/ws",
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          origin: "http://evil.example",
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
    expect(status).toBe(403);
  });
});

describe("the real socket upgrade", () => {
  it("serves the typed client and a live ws round-trip", async () => {
    const { args, composed } = bootApp();

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
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a bound AddressInfo");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // The typed hc client against the live server — contract → handler → client.
    const client = createApiClient(baseUrl);
    const healthResponse = await client.health.$get();
    expect(healthResponse.status).toBe(200);
    expect(healthResponseSchema.parse(await healthResponse.json())).toEqual({
      ok: true,
    });

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    cleanups.push(() => socket.close());

    const frames: unknown[] = [];
    let announceFrame: (() => void) | undefined;
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        frames.push(JSON.parse(event.data));
      }
      announceFrame?.();
    });

    async function nextFrame(): Promise<unknown> {
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
      return frames.shift();
    }

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("ws error")));
    });

    const hello = serverMessageLenientSchema.parse(await nextFrame());
    expect(hello).toEqual({ type: "hello", version: "0.1.0-test" });

    socket.send(JSON.stringify({ type: "subscribe", target: { kind: "doc-detail", docId: "d1" } }));
    // Subscription is processed on receipt; poll until the broadcast lands.
    const deadline = Date.now() + 5_000;
    let changed: unknown;
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
    expect(serverMessageLenientSchema.parse(changed)).toEqual({
      type: "changed",
      entity: "doc",
      id: "d1",
      changes: ["content-changed"],
    });
  });
});
