import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { DEV_PORT_PROBE_LIMIT } from "./dev-instance";
import { errnoCode } from "./errno";

type ServeOptions = Parameters<typeof serve>[0];
type ServerType = ReturnType<typeof serve>;

export interface ListenArgs {
  fetch: ServeOptions["fetch"];
  hostname: string;
  port: number;
  // only for derived dev ports: a configured port that is busy is an error the user asked to see.
  probeOnBusyPort: boolean;
}

export interface ListenResult {
  port: number;
  server: ServerType;
}

const MAX_PORT_PROBES = DEV_PORT_PROBE_LIMIT;

const boundAddressSchema = z.object({ port: z.number().int() });

const isAddrInUse = (cause: unknown): boolean => errnoCode(cause) === "EADDRINUSE";

const listenOnce = async (
  fetch: ServeOptions["fetch"],
  hostname: string,
  port: number,
): Promise<ListenResult> => {
  const server = serve({ fetch, hostname, port });
  // rejects on the bind error, so a busy port surfaces as the exception the retry reads.
  await once(server, "listening");
  // a tcp listener reports an address record; port 0 lands wherever the OS put it.
  const bound = boundAddressSchema.safeParse(server.address());
  return { port: bound.success ? bound.data.port : port, server };
};

export interface UpgradedSockets {
  closeAllClients: () => void;
  terminateAllClients: () => void;
}

// generous enough for a laptop waking up, far short of the step's own budget.
const SOCKET_DRAIN_MS = 1500;

// an upgraded socket is detached from the http server's connection tracking:
// server.close() never fires while one is open and closeAllConnections() does
// not touch it, so the websockets are closed by name first.
export const closeServer = async (server: ServerType, sockets: UpgradedSockets): Promise<void> => {
  let closed = false;
  const finished = (async () => {
    await once(server, "close");
    closed = true;
  })();
  server.close();

  sockets.closeAllClients();
  if ("closeAllConnections" in server) {
    server.closeAllConnections();
  }

  await Promise.race([finished, delay(SOCKET_DRAIN_MS, undefined, { ref: false })]);
  if (closed) {
    return;
  }
  sockets.terminateAllClients();
  await Promise.race([finished, delay(SOCKET_DRAIN_MS, undefined, { ref: false })]);
  if (!closed) {
    // a listener this process could not close is a port the next boot will not get.
    throw new Error(`sockets did not drain within ${SOCKET_DRAIN_MS * 2}ms`);
  }
};

export const listenWithRetry = async (args: ListenArgs): Promise<ListenResult> => {
  const attempts = args.probeOnBusyPort ? MAX_PORT_PROBES : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = args.port + attempt;
    try {
      const result = await listenOnce(args.fetch, args.hostname, port);
      // port 0 asks the OS for any port, so landing elsewhere is not a probe.
      if (args.port !== 0 && result.port !== args.port) {
        console.log(`port ${args.port} is taken — listening on ${result.port} instead`);
      }
      return result;
    } catch (error) {
      if (!isAddrInUse(error) || attempt === attempts - 1) {
        throw error;
      }
    }
  }
  throw new Error(`no free port in ${args.port}–${args.port + MAX_PORT_PROBES - 1}`);
};
