// The fake Managed Agents API on a port of its own, for a Worker whose SDK reaches it through its
// `baseURL`: node's HTTP server in front of the fake's fetch handler, every response streamed as
// it is written, so an event stream reaches its reader as each event happens and lets go of the
// session when the reader goes.

import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { fakeManagedAgents } from "./fake-api.ts";
import type { FakeManagedAgents } from "./fake-api.ts";
import type { ConnectorFetch } from "./fake-connector.ts";

export interface ServedFake {
  readonly api: FakeManagedAgents;
  // what the Worker's SDK takes as its `baseURL`
  readonly origin: string;
  readonly close: () => Promise<void>;
}

const addressSchema = z.object({ port: z.number().int().positive() });

const requestOf = async (incoming: IncomingMessage, origin: string): Promise<Request> => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const headers = new Headers();
  for (let index = 0; index + 1 < incoming.rawHeaders.length; index += 2) {
    headers.append(incoming.rawHeaders[index] ?? "", incoming.rawHeaders[index + 1] ?? "");
  }
  const method = incoming.method ?? "GET";
  return new Request(new URL(incoming.url ?? "/", origin), {
    body: method === "GET" || method === "HEAD" ? null : Buffer.concat(chunks),
    headers,
    method,
  });
};

// one request answered, a failure of the fake's own logged and answered 500
const answer = async (
  api: FakeManagedAgents,
  origin: string,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> => {
  try {
    const response = await api.fetch(await requestOf(incoming, origin));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    // node holds the head until the first write, and an event stream may wait minutes for its
    // first event: a reader whose client times out on the head would never see it
    outgoing.flushHeaders();
    if (response.body === null) {
      outgoing.end();
      return;
    }
    const reader = response.body.getReader();
    outgoing.on("close", () => {
      void reader.cancel();
    });
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      outgoing.write(read.value);
    }
  } catch (error) {
    console.error({
      event: "managed-agents-fake-failed",
      message: error instanceof Error ? error.message : "the request failed",
    });
    if (!outgoing.headersSent) {
      outgoing.writeHead(500);
    }
  }
  outgoing.end();
};

export const serveFakeManagedAgents = async (options: {
  readonly port: number;
  readonly host?: string;
  readonly connectorFetch?: ConnectorFetch;
}): Promise<ServedFake> => {
  const host = options.host ?? "127.0.0.1";
  const api = fakeManagedAgents({
    connectorFetch: options.connectorFetch ?? (async (request) => await fetch(request)),
  });
  let origin = "";
  const server = createServer((incoming, outgoing) => {
    void answer(api, origin, incoming, outgoing);
  });
  server.listen(options.port, host);
  await once(server, "listening");
  const { port } = addressSchema.parse(server.address());
  origin = `http://${host}:${String(port)}`;
  return {
    api,
    close: async () => {
      const closed = once(server, "close");
      server.closeAllConnections();
      server.close();
      await closed;
    },
    origin,
  };
};
