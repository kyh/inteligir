import { serve } from "@hono/node-server";
import { DEV_PORT_PROBE_LIMIT } from "./config";
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

function isAddrInUse(error: unknown): boolean {
  return errnoCode(error) === "EADDRINUSE";
}

function listenOnce(
  fetch: ServeOptions["fetch"],
  hostname: string,
  port: number,
): Promise<ListenResult> {
  return new Promise((resolve, reject) => {
    const onError = (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const server = serve({ fetch, hostname, port }, (info) => {
      server.removeListener("error", onError);
      resolve({ port: info.port, server });
    });
    server.once("error", onError);
  });
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
