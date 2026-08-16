import { createServer, type Server } from "node:net";

function listenOnEphemeral(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => reject(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
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

/**
 * Ask the OS for `count` distinct free loopback ports by holding them all
 * bound at once before releasing — sequential reserve/release could hand the
 * same port back twice. The app refuses `INTELIGIR_PORT=0` (a configured
 * port must be a real one) and only probes upward from DERIVED dev ports, so
 * the harness reserves concrete ports per instance. The release→spawn window
 * is a race in theory; losing it fails the boot loudly and the launcher
 * retries with fresh ports.
 */
export async function reserveFreePorts(count: number): Promise<number[]> {
  const held: { server: Server; port: number }[] = [];
  try {
    for (let index = 0; index < count; index += 1) {
      held.push(await listenOnEphemeral());
    }
  } finally {
    await Promise.all(held.map(({ server }) => closeServer(server)));
  }
  return held.map(({ port }) => port);
}
