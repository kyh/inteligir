// A client's connection to a booted Worker, through a relay the scenario can cut: a TCP forwarder
// on a port of its own, so the client's calls and uploads reach the Worker as they would the cloud,
// and a cut refuses every new connection and drops every open one, the way a device that lost its
// network meets the cloud. Restored, it listens on the same port again, so the client finds the
// cloud where it left it. Closed at the scenario's teardown, it stays closed: a run abandoned at its
// deadline can still ask for a restore, and a listener it opened then would belong to nothing.

import { connect, createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { loopbackOrigin } from "./ports";

export interface CloudLink {
  // the origin the client is told the cloud is at
  readonly origin: string;
  readonly cut: () => Promise<void>;
  // refused once the link closed
  readonly restore: () => Promise<void>;
  readonly close: () => Promise<void>;
}

// a cut or a close asked while a restore listens waits for it to settle, then acts on what it left
type Link =
  | { readonly kind: "up"; readonly server: Server }
  | { readonly kind: "cut"; readonly stopped: Promise<void> }
  | { readonly kind: "restoring"; readonly ready: Promise<void> }
  | { readonly kind: "closed"; readonly stopped: Promise<void> };

type LinkEvent =
  | { readonly kind: "cut"; readonly stopped: Promise<void> }
  | { readonly kind: "closed"; readonly stopped: Promise<void> }
  | { readonly kind: "restoring"; readonly ready: Promise<void> }
  | { readonly kind: "listened"; readonly server: Server }
  | { readonly kind: "lost" };

const linkAfter = (link: Link, event: LinkEvent): Link => {
  switch (event.kind) {
    case "cut": {
      return link.kind === "up" ? { kind: "cut", stopped: event.stopped } : link;
    }
    case "closed": {
      return link.kind === "up" || link.kind === "cut"
        ? { kind: "closed", stopped: event.stopped }
        : link;
    }
    case "restoring": {
      return link.kind === "cut" ? { kind: "restoring", ready: event.ready } : link;
    }
    case "listened": {
      return link.kind === "restoring" ? { kind: "up", server: event.server } : link;
    }
    // the port was taken while the link was cut: it stays cut, and the restore says why
    case "lost": {
      return link.kind === "restoring" ? { kind: "cut", stopped: Promise.resolve() } : link;
    }
    // no default
  }
};

const listening = async (server: Server, port: number): Promise<number> =>
  // oxlint-disable-next-line promise/avoid-new -- node:net is event/callback only; listen has no promise form.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!(address instanceof Object)) {
        reject(new Error("expected a bound AddressInfo"));
        return;
      }
      resolve(address.port);
    });
  });

const closed = async (server: Server): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- node:net is event/callback only; close has no promise form.
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
};

// Each ask waits in a loop that reads the link again once a restore settles, with no turn between
// that read and its step, so no ask acts on a link another ask has moved meanwhile.
const restored = async (ready: Promise<void>): Promise<void> => {
  try {
    await ready;
  } catch {
    // the restore that listened says why, and the link stays cut
  }
};

export const openCloudLink = async (workerOrigin: string): Promise<CloudLink> => {
  const target = new URL(workerOrigin);
  const open = new Set<Socket>();
  const relay = (inbound: Socket): void => {
    const outbound = connect(Number(target.port), target.hostname);
    for (const socket of [inbound, outbound]) {
      open.add(socket);
      socket.on("close", () => {
        open.delete(socket);
      });
      socket.on("error", () => {
        inbound.destroy();
        outbound.destroy();
      });
    }
    inbound.pipe(outbound);
    outbound.pipe(inbound);
  };
  const first = createServer(relay);
  const port = await listening(first, 0);
  let link: Link = { kind: "up", server: first };

  const stop = async (server: Server): Promise<void> => {
    const stopping = closed(server);
    for (const socket of open) {
      socket.destroy();
    }
    await stopping;
  };
  const drop = async (to: "cut" | "closed"): Promise<void> => {
    while (link.kind === "restoring") {
      await restored(link.ready);
    }
    const from = link;
    const stopped = from.kind === "up" ? stop(from.server) : from.stopped;
    link = linkAfter(from, { kind: to, stopped });
    await stopped;
  };

  return {
    close: async () => {
      await drop("closed");
    },
    cut: async () => {
      await drop("cut");
    },
    origin: loopbackOrigin(port),
    restore: async () => {
      while (link.kind === "restoring") {
        await restored(link.ready);
      }
      const from = link;
      if (from.kind === "closed") {
        throw new Error("the cloud link was asked to restore after it closed");
      }
      if (from.kind === "up") {
        return;
      }
      const ready = (async (): Promise<void> => {
        try {
          await from.stopped;
          const server = createServer(relay);
          await listening(server, port);
          link = linkAfter(link, { kind: "listened", server });
        } catch (error) {
          link = linkAfter(link, { kind: "lost" });
          throw error;
        }
      })();
      link = linkAfter(from, { kind: "restoring", ready });
      await ready;
    },
  };
};
