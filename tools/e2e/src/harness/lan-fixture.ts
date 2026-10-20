// a page server on this machine's own LAN address, for a save whose fetch must leave loopback: the
// guarded fetch refuses loopback, link-local and reserved space, and reaches private space only
// from a saved address that is itself private, which this one is. It never reaches past this
// machine, so a scenario saves no URL that leaves it (§0.2.9). `startLoopbackFixture` serves the
// same routes on loopback, for a page only the phone's runtime reads: the phone has no address
// guard, so a link saved on it reads on every machine, a sandbox with no LAN address included.
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
  // hold responses on path until the returned release is called
  hold: (path: string) => () => void;
  close: () => Promise<void>;
}

// the space a page served on this machine may be read from: a private address, which a saved
// private address reaches. This machine's own public address is the guard's "this Mac", refused
// like loopback, and every other class is refused before any dial
const READABLE = new Set(["private"]);

const lanAddress = (): string => {
  const own = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
  const usable = own.find((address) => READABLE.has(classifyAddress(address)));
  if (usable === undefined) {
    const held = own.map((address) => `${address} (${classifyAddress(address)})`).join(", ");
    throw new ScenarioSkipError(
      `no usable LAN address: the guarded fetch reads a page served on this machine only from its private space, and this machine holds ${held === "" ? "no non-loopback IPv4 address" : held}`,
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

interface Hold {
  waiting: (() => void)[];
  released: boolean;
}

// the routes on one server, its responses held by a gate or a hold
const routeServer = (routes: Readonly<Record<string, LanRoute>>) => {
  const seen: { path: string; at: number }[] = [];
  const gates = new Map<string, Gate>();
  const holds = new Map<string, Hold>();
  const server = createServer((request, response) => {
    const path = pathOf(request);
    seen.push({ at: Date.now(), path });
    const respond = () => {
      answer(response, routes[path]);
    };
    const held = holds.get(path);
    if (held !== undefined && !held.released) {
      held.waiting.push(respond);
      return;
    }
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
  const releaseAll = (): void => {
    // a held response would keep its socket open past close
    for (const gate of gates.values()) {
      for (const release of gate.waiting) {
        release();
      }
    }
    gates.clear();
    for (const held of holds.values()) {
      held.released = true;
      for (const release of held.waiting) {
        release();
      }
    }
    holds.clear();
  };
  return {
    controls: {
      gate(path: string, count: number) {
        gates.set(path, { count, waiting: [] });
      },
      hold(path: string) {
        const held: Hold = { released: false, waiting: [] };
        holds.set(path, held);
        return () => {
          held.released = true;
          for (const release of held.waiting) {
            release();
          }
          held.waiting = [];
        };
      },
      requests: () => seen,
    },
    releaseAll,
    server,
  };
};

export const startLanFixture = async (
  routes: Readonly<Record<string, LanRoute>>,
): Promise<LanFixture> => {
  const host = lanAddress();
  const { controls, releaseAll, server } = routeServer(routes);
  // the guard refuses the app's own port on any address, and the kernel will hand a LAN bind the
  // port an instance holds on loopback; so the fixture holds its port on loopback too, for its
  // whole life, where no instance, booted before it or after, can then listen
  const claim = createServer();
  claim.listen(0, "127.0.0.1");
  await once(claim, "listening");
  const { port } = boundPortSchema.parse(claim.address());
  server.listen(port, host);
  // rejects on the server's "error" instead, as a refused bind would
  await once(server, "listening");
  const origin = `http://${host}:${port}`;
  return {
    ...controls,
    async close() {
      releaseAll();
      server.closeAllConnections();
      const closed = Promise.all([once(server, "close"), once(claim, "close")]);
      server.close();
      claim.close();
      await closed;
    },
    origin,
    url: (path) => `${origin}${path}`,
  };
};

export const startLoopbackFixture = async (
  routes: Readonly<Record<string, LanRoute>>,
): Promise<LanFixture> => {
  const { controls, releaseAll, server } = routeServer(routes);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = boundPortSchema.parse(server.address());
  const origin = `http://127.0.0.1:${port}`;
  return {
    ...controls,
    async close() {
      releaseAll();
      server.closeAllConnections();
      const closed = once(server, "close");
      server.close();
      await closed;
    },
    origin,
    url: (path) => `${origin}${path}`,
  };
};
