import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import { connect, createServer } from "node:net";
import type { Server, Socket } from "node:net";
import type { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { closeServer, listenWithRetry } from "../listen";
import type { ListenResult } from "../listen";
import { boundAddressSchema } from "./bound-address";

const closeNetServer = async (server: Server): Promise<void> => {
  server.close();
  await once(server, "close");
};

const occupyPort = async (): Promise<number> => {
  const blocker = createServer();
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  onTestFinished(async () => {
    await closeNetServer(blocker);
  });
  return boundAddressSchema.parse(blocker.address()).port;
};

const trackResult = (result: ListenResult): ListenResult => {
  onTestFinished(async () => {
    result.server.close();
    await once(result.server, "close");
  });
  return result;
};

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

const upgradeAgainst = async (port: number): Promise<Socket> => {
  const client = connect(port, "127.0.0.1");
  await once(client, "connect");
  onTestFinished(() => {
    client.destroy();
  });
  const answered = once(client, "data");
  client.write(
    `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
  );
  await answered;
  return client;
};

interface UpgradingServer {
  server: HttpServer;
  port: number;
  // the server halves: destroying the client half proves nothing, the server's own socket is what close() waits on.
  serverSockets: Duplex[];
}

const upgradingServer = async (): Promise<UpgradingServer> => {
  const serverSockets: Duplex[] = [];
  const server = createHttpServer((_req, res) => {
    res.end("ok");
  });
  server.on("upgrade", (_req, socket) => {
    serverSockets.push(socket);
    socket.on("error", () => {});
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
  });
  onTestFinished(() => {
    for (const socket of serverSockets) {
      socket.destroy();
    }
    server.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = boundAddressSchema.safeParse(server.address());
  return { port: address.success ? address.data.port : 0, server, serverSockets };
};

const noSockets = { closeAllClients: () => {}, terminateAllClients: () => {} };

describe("closeServer", () => {
  it("Node's own close() never completes while a socket is upgraded", async () => {
    // if this ever resolves quickly, the by-name websocket close has become unnecessary rather than untested.
    const { server, port } = await upgradingServer();
    await upgradeAgainst(port);

    let closed = false;
    server.close(() => {
      closed = true;
    });
    server.closeAllConnections();
    await delay(400);

    expect(closed).toBe(false);
  });

  it("completes anyway, because it terminates the websockets by name", async () => {
    const { server, port, serverSockets } = await upgradingServer();
    await upgradeAgainst(port);

    // mirrors WsBus: the close frame first, then terminate destroys the server-side socket.
    let closeFrames = 0;
    const sockets = {
      closeAllClients: () => {
        closeFrames += 1;
      },
      terminateAllClients: () => {
        for (const socket of serverSockets) {
          socket.destroy();
        }
      },
    };

    const startedAt = Date.now();
    await closeServer(server, sockets);
    expect(closeFrames).toBe(1);
    // under the vault step's own budget.
    expect(Date.now() - startedAt).toBeLessThan(6000);
  });

  it("closes promptly when the client answers its close frame", async () => {
    const { server, port, serverSockets } = await upgradingServer();
    await upgradeAgainst(port);

    const startedAt = Date.now();
    await closeServer(server, {
      closeAllClients: () => {
        for (const socket of serverSockets) {
          socket.end();
        }
      },
      terminateAllClients: () => {
        throw new Error("a cooperative client must never reach the terminate pass");
      },
    });
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });

  it("closes with no upgraded sockets at all", async () => {
    const { server } = await upgradingServer();
    await expect(closeServer(server, noSockets)).resolves.toBeUndefined();
  });
});
