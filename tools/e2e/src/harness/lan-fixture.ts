// a page server on this machine's own LAN address, for a save whose fetch must leave loopback: the
// guarded fetch refuses loopback, link-local and reserved space, and reaches private space only
// from a saved address that is itself private, which this one is. It never reaches past this
// machine, so a scenario saves no URL that leaves it (§0.2.9).
//
// The address is the first the guard itself would read a page from, judged by the guard's own
// classification: a machine whose only addresses are in space the guard refuses (a sandbox in
// TEST-NET, say) has no page a save can read, and a scenario that needs one skips here, at its
// start, rather than failing a fill it was never going to see. The guard is never widened for it.

import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { classifyAddress } from "inteligir/server/address-guard";
import { z } from "zod";
import { ScenarioSkipError } from "./scenario-skip-error";

export interface LanRoute {
  status?: number;
  // the content type; text/html by default
  type?: string;
  body?: string | Uint8Array;
  // answers 302 to this location
  redirect?: string;
}

export interface LanFixture {
  origin: string;
  url: (path: string) => string;
  requests: () => readonly { path: string; at: number }[];
  // hold responses on path until `count` requests are waiting
  gate: (path: string, count: number) => void;
  close: () => Promise<void>;
}

// the space a saved page may be read from: a private address reaches only itself and the public
// web, a public one only the public web, and every other class is refused before any dial
const READABLE = new Set(["private", "public"]);

const lanAddress = (): string => {
  const own = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
  const usable = own.find((address) => READABLE.has(classifyAddress(address)));
  if (usable === undefined) {
    const held = own.map((address) => `${address} (${classifyAddress(address)})`).join(", ");
    throw new ScenarioSkipError(
      `no usable LAN address: the guarded fetch reads a page only from private or public space, and this machine holds ${held === "" ? "no non-loopback IPv4 address" : held}`,
    );
  }
  return usable;
};

const pathOf = (request: IncomingMessage): string => (request.url ?? "/").split("?")[0] ?? "/";

const answer = (response: ServerResponse, route: LanRoute | undefined): void => {
  if (route === undefined) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }
  if (route.redirect !== undefined) {
    response.writeHead(route.status ?? 302, { location: route.redirect });
    response.end();
    return;
  }
  response.writeHead(route.status ?? 200, {
    "content-type": route.type ?? "text/html; charset=utf-8",
  });
  response.end(route.body ?? "");
};

// `address()` answers a pipe name, an AddressInfo or null; a bound TCP port wants only the second
const boundPortSchema = z.object({ port: z.number().int() });

interface Gate {
  count: number;
  waiting: (() => void)[];
}

export const startLanFixture = async (
  routes: Readonly<Record<string, LanRoute>>,
): Promise<LanFixture> => {
  const host = lanAddress();
  const seen: { path: string; at: number }[] = [];
  const gates = new Map<string, Gate>();
  const server = createServer((request, response) => {
    const path = pathOf(request);
    seen.push({ at: Date.now(), path });
    const respond = () => {
      answer(response, routes[path]);
    };
    const gate = gates.get(path);
    if (gate === undefined) {
      respond();
      return;
    }
    gate.waiting.push(respond);
    if (gate.waiting.length >= gate.count) {
      gates.delete(path);
      for (const release of gate.waiting) {
        release();
      }
    }
  });
  server.listen(0, host);
  // rejects on the server's "error" instead, as a refused bind would
  await once(server, "listening");
  const { port } = boundPortSchema.parse(server.address());
  const origin = `http://${host}:${port}`;
  return {
    async close() {
      // a held response would keep its socket open past close
      for (const gate of gates.values()) {
        for (const release of gate.waiting) {
          release();
        }
      }
      gates.clear();
      server.closeAllConnections();
      const closed = once(server, "close");
      server.close();
      await closed;
    },
    gate(path, count) {
      gates.set(path, { count, waiting: [] });
    },
    origin,
    requests: () => seen,
    url: (path) => `${origin}${path}`,
  };
};
