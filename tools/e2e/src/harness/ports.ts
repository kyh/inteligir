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

// held all at once before releasing: sequential reserve/release can hand the same port back twice.
// concrete ports because the app refuses INTELIGIR_PORT=0; the release→spawn window is a race the
// boot loop retries.
export const reserveFreePorts = async (count: number): Promise<number[]> => {
  const held: HeldPort[] = [];
  try {
    for (let index = 0; index < count; index += 1) {
      held.push(await listenOnEphemeral());
    }
  } finally {
    await Promise.all(
      held.map(async ({ server }) => {
        await closeServer(server);
      }),
    );
  }
  return held.map(({ port }) => port);
};
