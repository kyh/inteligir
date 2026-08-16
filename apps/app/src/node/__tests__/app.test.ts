import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createConnection } from "@repo/db/connection";
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

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  // LIFO: the ws client must close before the server that holds it.
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

interface BootAppOptions {
  fallback?: AppFallback;
  migrate?: boolean;
  port?: number;
}

function bootApp(options: BootAppOptions = {}): {
  args: CreateAppArgs;
  composed: ReturnType<typeof createApp>;
} {
  const dataDir = mkdtempSync(join(tmpdir(), "inteligir-app-test-"));
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const databasePath = join(dataDir, "inteligir.db");
  const db = createConnection(databasePath);
  if (options.migrate ?? true) {
    runMigrations(db);
  }
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
    db,
    fallback: options.fallback ?? { kind: "none" },
    startedAt: Date.now(),
    version: "0.1.0-test",
  };
  return { args, composed: createApp(args) };
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
    const clientDir = mkdtempSync(join(tmpdir(), "inteligir-client-test-"));
    cleanups.push(() => rmSync(clientDir, { recursive: true, force: true }));
    writeFileSync(join(clientDir, "_shell.html"), "<!doctype html><title>shell</title>");
    const { composed } = bootApp({
      fallback: {
        kind: "prod",
        clientDir,
        startFetch: () => Promise.resolve(new Response("start", { status: 200 })),
      },
    });

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
    expect(await spaMiss.text()).toContain("shell");
  });

  it("answers handler failures with a generic 500, internals logged not echoed", async () => {
    // Un-migrated db: the status handler's schema-version read throws.
    const { composed } = bootApp({ migrate: false });
    const response = await composed.app.request("/api/v1/system/status");
    expect(response.status).toBe(500);
    const body = apiErrorResponseSchema.parse(await response.json());
    expect(body).toEqual({ error: "internal", message: "Internal server error" });
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
