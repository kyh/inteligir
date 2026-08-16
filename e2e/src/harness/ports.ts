import { createServer } from "node:net";

/**
 * Ask the OS for a free loopback port by binding to 0, then release it. The
 * app refuses `INTELIGIR_PORT=0` (a configured port must be a real one) and
 * only probes upward from DERIVED dev ports, so the harness reserves a
 * concrete port per instance. The reserve→spawn window is a race in theory;
 * losing it fails the boot loudly and a rerun draws a fresh port.
 */
export function reserveFreePort(): Promise<number> {
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
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}
