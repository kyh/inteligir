import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { connect, createServer, type Server, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { describe, expect, it, onTestFinished } from "vitest";
import { closeServer, listenWithRetry, type ListenResult } from "../listen";
import { boundAddressSchema } from "./bound-address";

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
  onTestFinished(() => closeNetServer(blocker));
  return boundAddressSchema.parse(blocker.address()).port;
}

function trackResult(result: ListenResult): ListenResult {
  onTestFinished(
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

async function upgradeAgainst(port: number): Promise<Socket> {
  const client = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
  onTestFinished(async () => {
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
  // the server halves: destroying the client half proves nothing, the server's own socket is what close() waits on.
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
  onTestFinished(async () => {
    for (const socket of serverSockets) socket.destroy();
    server.close();
  });
  return { server, listening, serverSockets };
}

const noSockets = { closeAllClients: () => {}, terminateAllClients: () => {} };

describe("closeServer", () => {
  it("Node's own close() never completes while a socket is upgraded", async () => {
    // if this ever resolves quickly, the by-name websocket close has become unnecessary rather than untested.
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

    // mirrors WsBus: the close frame first, then terminate destroys the server-side socket.
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
    // under the vault step's own budget.
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
