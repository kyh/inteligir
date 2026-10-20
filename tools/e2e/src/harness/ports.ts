import { createServer } from "node:net";
import type { Server } from "node:net";

interface HeldPort {
  server: Server;
  port: number;
}

const listenOnEphemeral = async (): Promise<HeldPort> =>
  // oxlint-disable-next-line promise/avoid-new -- node:net is event/callback only; listen has no promise form.
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!(address instanceof Object)) {
        server.close();
        reject(new Error("expected a bound AddressInfo"));
        return;
      }
      resolve({ port: address.port, server });
    });
  });

const closeServer = async (server: Server): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- node:net is event/callback only; close has no promise form.
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

// every port this run has handed out: lanes reserve in one process, and the kernel may hand one
// lane's port, released for its child to bind, to the next lane's reservation before the child
// has bound it. A run hands out a few hundred of some 28,000, so none is ever handed out twice
const handedOut = new Set<number>();

// held all at once before releasing: sequential reserve/release can hand the same port back twice.
// concrete ports because the app refuses INTELIGIR_PORT=0; the release→spawn window is a race the
// boot loop retries, against what another process binds meanwhile.
export const reserveFreePorts = async (count: number): Promise<number[]> => {
  const held: HeldPort[] = [];
  const fresh: number[] = [];
  try {
    while (fresh.length < count) {
      const next = await listenOnEphemeral();
      held.push(next);
      if (!handedOut.has(next.port)) {
        fresh.push(next.port);
      }
    }
  } finally {
    await Promise.all(
      held.map(async ({ server }) => {
        await closeServer(server);
      }),
    );
  }
  for (const port of fresh) {
    handedOut.add(port);
  }
  return fresh;
};
