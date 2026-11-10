import { once } from "node:events";
import { Server as HttpServer } from "node:http";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { z } from "zod";

// a port on this machine as an origin a client calls
export const loopbackOrigin = (port: number): string => `http://127.0.0.1:${String(port)}`;

export interface LoopbackListener {
  readonly port: number;
  readonly origin: string;
  // stops listening, and drops what an HTTP server still holds open
  readonly close: () => Promise<void>;
}

// `address()` answers a pipe name, an AddressInfo or null; a bound TCP port wants only the second
const boundPortSchema = z.object({ port: z.number().int().positive() });

// a server listening on this machine's loopback, on `port` or an ephemeral one; refused when the
// port is taken
export const listenOnLoopback = async (server: Server, port = 0): Promise<LoopbackListener> => {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const bound = boundPortSchema.parse(server.address()).port;
  return {
    close: async () => {
      const closed = once(server, "close");
      if (server instanceof HttpServer) {
        server.closeAllConnections();
      }
      server.close();
      await closed;
    },
    origin: loopbackOrigin(bound),
    port: bound,
  };
};

// every port this run has handed out: lanes reserve in one process, and the kernel may hand one
// lane's port, released for its child to bind, to the next lane's reservation before the child
// has bound it. A run hands out a few hundred of some 28,000, so none is ever handed out twice
const handedOut = new Set<number>();

// held all at once before releasing: sequential reserve/release can hand the same port back twice.
// concrete ports because a child is told the port it binds and the harness the one it dials, before
// either runs; the release→spawn window is a race the boot loop retries, against what another
// process binds meanwhile.
export const reserveFreePorts = async (count: number): Promise<number[]> => {
  const held: LoopbackListener[] = [];
  const fresh: number[] = [];
  try {
    while (fresh.length < count) {
      const next = await listenOnLoopback(createServer());
      held.push(next);
      if (!handedOut.has(next.port)) {
        fresh.push(next.port);
      }
    }
  } finally {
    await Promise.all(
      held.map(async (listener) => {
        await listener.close();
      }),
    );
  }
  for (const port of fresh) {
    handedOut.add(port);
  }
  return fresh;
};
