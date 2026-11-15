// The scripted Messages API on a port of its own, for a Worker whose client reaches it through
// `ANTHROPIC_FAKE_URL`: srvx's node server in front of the fake's fetch handler, which sends a
// reply's events as they are written and aborts a stalled reply's request when its client goes.

import { serve } from "srvx";

import { messagesFake } from "./messages-fake.ts";
import type { FakeStats } from "./messages-fake.ts";

export interface ServedFake {
  // what the Worker's client takes as its base URL
  readonly origin: string;
  // its counters, for a caller in this process; `/__fake/stats` answers them over the wire
  readonly stats: () => FakeStats;
  readonly close: () => Promise<void>;
}

export const serveMessagesFake = async (port: number): Promise<ServedFake> => {
  const fake = messagesFake();
  const server = serve({
    // `silent` drops srvx's own line for a request that threw, so the fake's is logged here
    error: (error) => {
      console.error({
        event: "messages-fake-failed",
        message: error instanceof Error ? error.message : "the request failed",
      });
      return new Response(null, { status: 500 });
    },
    // srvx's request is not one `new Request` copies, so the fake is handed its parts
    fetch: async (request) =>
      await fake.fetch(request.url, {
        body:
          request.method === "GET" || request.method === "HEAD"
            ? null
            : await request.arrayBuffer(),
        headers: request.headers,
        method: request.method,
        signal: request.signal,
      }),
    // srvx's SIGINT and SIGTERM handlers would land in whatever process serves it, a Playwright
    // worker among them
    gracefulShutdown: false,
    hostname: "127.0.0.1",
    port,
    silent: true,
  });
  const { url } = await server.ready();
  if (url === undefined) {
    throw new Error("The scripted Messages API is listening at no address.");
  }
  return {
    close: async () => {
      await server.close(true);
    },
    origin: new URL(url).origin,
    stats: fake.stats,
  };
};
