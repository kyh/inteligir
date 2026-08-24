import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { connect, createServer, type Server, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { closeServer, listenWithRetry, type ListenResult } from "../listen";
import { boundAddressSchema } from "./bound-address";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function closeNetServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function occupyPort(): Promise<number> {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => closeNetServer(blocker));
  return boundAddressSchema.parse(blocker.address()).port;
}

function trackResult(result: ListenResult): ListenResult {
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        result.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  );
  return result;
}

const okFetch = () => new Response("ok");

describe("listenWithRetry", () => {
  it("probes upward from a busy derived port and reports the winner", async () => {
    const busyPort = await occupyPort();
    const result = trackResult(
      await listenWithRetry({
        fetch: okFetch,
        hostname: "127.0.0.1",
        port: busyPort,
        probeOnBusyPort: true,
      }),
    );
    expect(result.port).toBeGreaterThan(busyPort);
    expect(result.port).toBeLessThan(busyPort + 10);
  });

  it("refuses to probe a configured port", async () => {
    const busyPort = await occupyPort();
    await expect(
      listenWithRetry({
        fetch: okFetch,
        hostname: "127.0.0.1",
        port: busyPort,
        probeOnBusyPort: false,
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("binds and reports the bound port", async () => {
    const result = trackResult(
      await listenWithRetry({
        fetch: okFetch,
        hostname: "127.0.0.1",
        port: 0,
        probeOnBusyPort: false,
      }),
    );
    expect(result.port).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The shutdown blocker, pinned from both sides.
//
// An UPGRADED socket is detached from the HTTP server's connection tracking:
// `server.close()`'s callback never fires while one is open and
// `closeAllConnections()` does not touch it. That is Node's behaviour, not a
// bug in this app — but relying on those two alone means one open browser tab
// stalls the entire teardown behind step one, and the pending vault commit and
// the database close never run. The first test states Node's semantics so the
// reason is not lost; the second is the regression.
// ---------------------------------------------------------------------------

/** A socket that completes an upgrade handshake and then just sits there. */
async function upgradeAgainst(port: number): Promise<Socket> {
  const client = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
  cleanups.push(async () => {
    client.destroy();
  });
  const answered = new Promise<void>((resolve) => client.once("data", () => resolve()));
  client.write(
    `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
  );
  await answered;
  return client;
}

interface UpgradingServer {
  server: HttpServer;
  listening: Promise<number>;
  /** The SERVER halves of every upgraded connection — what `ws` owns and what
   *  `terminate()` destroys. Destroying the client half instead proves
   *  nothing: the server's own socket is what `close()` is waiting on.
   *  `Duplex` because that is what the `upgrade` event hands over. */
  serverSockets: Duplex[];
}

function upgradingServer(): UpgradingServer {
  const serverSockets: Duplex[] = [];
  const server = createHttpServer((_req, res) => res.end("ok"));
  server.on("upgrade", (_req, socket) => {
    serverSockets.push(socket);
    socket.on("error", () => {});
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
  });
  const listening = new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = boundAddressSchema.safeParse(server.address());
      resolve(address.success ? address.data.port : 0);
    });
  });
  cleanups.push(async () => {
    for (const socket of serverSockets) socket.destroy();
    server.close();
  });
  return { server, listening, serverSockets };
}

const noSockets = { closeAllClients: () => {}, terminateAllClients: () => {} };

describe("closeServer", () => {
  it("Node's own close() never completes while a socket is upgraded", async () => {
    // THE PREMISE, pinned. If this ever starts resolving quickly, the
    // websocket handling below has become unnecessary rather than untested —
    // which is worth knowing either way.
    const { server, listening } = upgradingServer();
    const port = await listening;
    await upgradeAgainst(port);

    let closed = false;
    server.close(() => {
      closed = true;
    });
    server.closeAllConnections();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(closed).toBe(false);
  });

  it("completes anyway, because it terminates the websockets by name", async () => {
    const { server, listening, serverSockets } = upgradingServer();
    const port = await listening;
    await upgradeAgainst(port);

    // What WsBus does to a real transport: the graceful close frame first,
    // then `raw.terminate()`, which destroys the server-side socket.
    let closeFrames = 0;
    const sockets = {
      closeAllClients: () => {
        closeFrames += 1;
      },
      terminateAllClients: () => {
        for (const socket of serverSockets) socket.destroy();
      },
    };

    const startedAt = Date.now();
    await closeServer(server, sockets);
    expect(closeFrames).toBe(1);
    // Under the vault step's own budget, which is the property that matters:
    // the teardown is no longer hostage to an open tab.
    expect(Date.now() - startedAt).toBeLessThan(6_000);
  });

  it("closes promptly when the client answers its close frame", async () => {
    const { server, listening, serverSockets } = upgradingServer();
    const port = await listening;
    await upgradeAgainst(port);

    const startedAt = Date.now();
    await closeServer(server, {
      closeAllClients: () => {
        for (const socket of serverSockets) socket.end();
      },
      terminateAllClients: () => {
        throw new Error("a cooperative client must never reach the terminate pass");
      },
    });
    expect(Date.now() - startedAt).toBeLessThan(1_500);
  });

  it("closes with no upgraded sockets at all", async () => {
    const { server, listening } = upgradingServer();
    await listening;
    await expect(closeServer(server, noSockets)).resolves.toBeUndefined();
  });
});
