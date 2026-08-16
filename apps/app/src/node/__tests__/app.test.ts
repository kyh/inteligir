import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { healthResponseSchema, systemStatusResponseSchema } from "@repo/server-contract/routes";
import { createApiClient } from "@repo/server-contract/client";
import { serverMessageLenientSchema } from "@repo/server-contract/notifications";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type CreateAppArgs } from "../app";
import { WsBus } from "../ws-bus";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  // LIFO: the ws client must close before the server that holds it.
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

function bootApp(): { args: CreateAppArgs; composed: ReturnType<typeof createApp> } {
  const dataDir = mkdtempSync(join(tmpdir(), "inteligir-app-test-"));
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const databasePath = join(dataDir, "inteligir.db");
  const db = createConnection(databasePath);
  runMigrations(db);
  const args: CreateAppArgs = {
    bus: new WsBus({ version: "0.1.0-test" }),
    config: { databasePath, dataDir, mode: "dev", port: 0 },
    db,
    fallback: { kind: "none" },
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
