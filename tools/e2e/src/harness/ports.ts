import { createServer, type Server } from "node:net";

interface HeldPort {
  server: Server;
  port: number;
}

function listenOnEphemeral(): Promise<HeldPort> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => reject(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!(address instanceof Object)) {
        server.close();
        reject(new Error("expected a bound AddressInfo"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
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

// held all at once before releasing: sequential reserve/release can hand the same port back twice.
// concrete ports because the app refuses INTELIGIR_PORT=0; the release→spawn window is a race the
// boot loop retries.
export async function reserveFreePorts(count: number): Promise<number[]> {
  const held: HeldPort[] = [];
  try {
    for (let index = 0; index < count; index += 1) {
      held.push(await listenOnEphemeral());
    }
  } finally {
    await Promise.all(held.map(({ server }) => closeServer(server)));
  }
  return held.map(({ port }) => port);
}
