import { serve } from "@hono/node-server";
import { DEV_PORT_PROBE_LIMIT } from "./dev-instance";
import { errnoCode } from "./errno";

type ServeOptions = Parameters<typeof serve>[0];
type ServerType = ReturnType<typeof serve>;

export interface ListenArgs {
  fetch: ServeOptions["fetch"];
  hostname: string;
  port: number;
  /** Probe upward on EADDRINUSE. Only for derived dev ports — a configured
   *  port that is busy is an error the user asked to see. */
  probeOnBusyPort: boolean;
}

export interface ListenResult {
  port: number;
  server: ServerType;
}

/** The derivation scheme AND the probe bound live in config.ts, so the CLI's
 *  discovery dials exactly the range this file may bind. */
const MAX_PORT_PROBES = DEV_PORT_PROBE_LIMIT;

function isAddrInUse(cause: unknown): boolean {
  return errnoCode(cause) === "EADDRINUSE";
}

function listenOnce(
  fetch: ServeOptions["fetch"],
  hostname: string,
  port: number,
): Promise<ListenResult> {
  return new Promise((resolve, reject) => {
    const onError = (cause: unknown) => {
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    const server = serve({ fetch, hostname, port }, (info) => {
      server.removeListener("error", onError);
      resolve({ port: info.port, server });
    });
    server.once("error", onError);
  });
}

/** The websocket half of the shutdown, injected so this module never has to
 *  know what a bus is. */
export interface UpgradedSockets {
  /** Send every client a close frame. */
  closeAllClients(): void;
  /** Destroy the transports that did not answer one. */
  terminateAllClients(): void;
}

/** How long a client gets to answer its close frame before the transport is
 *  destroyed. Generous enough for a laptop waking up, far short of the step's
 *  own budget. */
const SOCKET_DRAIN_MS = 1_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

/**
 * Stop serving.
 *
 * THE WEBSOCKETS MUST BE CLOSED BY NAME, and this is the one thing about
 * shutdown that is not obvious: an upgraded socket is DETACHED from the HTTP
 * server's connection tracking, so `server.close()`'s callback never fires
 * while one is open and `closeAllConnections()` does not touch it. Relying on
 * those two alone means one open tab stalls the whole teardown — the vault's
 * pending commit and the database close are queued behind a step that cannot
 * finish, which is the opposite of what a graceful shutdown is for.
 *
 * So: close frames first (a client learns the server is going away rather than
 * seeing its connection drop), then the keep-alive HTTP connections, then a
 * bounded drain, then destroy whatever is left.
 */
export async function closeServer(server: ServerType, sockets: UpgradedSockets): Promise<void> {
  let closed = false;
  const finished = new Promise<void>((resolve) => {
    server.close(() => {
      closed = true;
      resolve();
    });
  });

  sockets.closeAllClients();
  if ("closeAllConnections" in server) {
    server.closeAllConnections();
  }

  await Promise.race([finished, delay(SOCKET_DRAIN_MS)]);
  if (closed) {
    return;
  }
  sockets.terminateAllClients();
  await Promise.race([finished, delay(SOCKET_DRAIN_MS)]);
  if (!closed) {
    // Reported as a FAILED step rather than swallowed: a listener this process
    // could not close is a port the next boot will not get.
    throw new Error(`sockets did not drain within ${SOCKET_DRAIN_MS * 2}ms`);
  }
}

export async function listenWithRetry(args: ListenArgs): Promise<ListenResult> {
  const attempts = args.probeOnBusyPort ? MAX_PORT_PROBES : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = args.port + attempt;
    try {
      const result = await listenOnce(args.fetch, args.hostname, port);
      // Port 0 asks the OS for any port, so landing elsewhere is not a probe.
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
}
