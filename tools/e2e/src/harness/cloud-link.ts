// The desktop shell's connection to a booted Worker, through a relay the scenario can cut: a TCP
// forwarder on a port of its own, so the shell's calls, uploads and socket reach the Worker as
// they would the cloud, and a cut refuses every new connection and drops every open one, the way a
// Mac that lost its network meets the cloud. Restored, it listens on the same port again, so the
// shell finds the cloud where it left it.

import { connect, createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { loopbackOrigin } from "./ports";

export interface CloudLink {
  // the origin the shell is told the cloud is at
  readonly origin: string;
  readonly cut: () => Promise<void>;
  readonly restore: () => Promise<void>;
  readonly close: () => Promise<void>;
}

const listening = async (server: Server, port: number): Promise<number> =>
  // oxlint-disable-next-line promise/avoid-new -- node:net is event/callback only; listen has no promise form.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!(address instanceof Object)) {
        reject(new Error("expected a bound AddressInfo"));
        return;
      }
      resolve(address.port);
    });
  });

const closed = async (server: Server): Promise<void> =>
  // oxlint-disable-next-line promise/avoid-new -- node:net is event/callback only; close has no promise form.
  await new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });

export const openCloudLink = async (workerOrigin: string): Promise<CloudLink> => {
  const target = new URL(workerOrigin);
  const open = new Set<Socket>();
  const relay = (inbound: Socket): void => {
    const outbound = connect(Number(target.port), target.hostname);
    for (const socket of [inbound, outbound]) {
      open.add(socket);
      socket.on("close", () => {
        open.delete(socket);
      });
      socket.on("error", () => {
        inbound.destroy();
        outbound.destroy();
      });
    }
    inbound.pipe(outbound);
    outbound.pipe(inbound);
  };
  let server = createServer(relay);
  const port = await listening(server, 0);
  let up = true;
  const drop = async (): Promise<void> => {
    if (!up) {
      return;
    }
    up = false;
    const stopping = closed(server);
    for (const socket of open) {
      socket.destroy();
    }
    await stopping;
  };
  return {
    close: drop,
    cut: drop,
    origin: loopbackOrigin(port),
    restore: async () => {
      if (up) {
        return;
      }
      server = createServer(relay);
      await listening(server, port);
      up = true;
    },
  };
};
