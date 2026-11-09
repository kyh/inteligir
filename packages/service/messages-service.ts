// The scripted Messages API the Worker's suites run the built-in agent against
// (`@repo/messages-fake`), served from the node process miniflare runs them from: every fetch a
// suite's Worker or Durable Object makes leaves workerd through this outbound service, so a
// conversation's object reaches the fake at `ANTHROPIC_FAKE_URL` with its real client, as the
// local Worker's does, and a stream the object holds open lets go when the object is reset. Any
// other address is refused, so no suite reaches the network.

import { messagesFake } from "@repo/messages-fake/messages-fake";

// the address the suites bind as `ANTHROPIC_FAKE_URL` (cloudflare.config.ts), on this machine
// alone, as the client requires
export const MESSAGES_FAKE_ORIGIN = "http://127.0.0.1:5177";

const fake = messagesFake();

export const messagesService = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.origin !== MESSAGES_FAKE_ORIGIN) {
    return new Response(`The suites reach no network: ${url.origin} is not the scripted API.`, {
      status: 502,
    });
  }
  return await fake.fetch(url, {
    body: request.method === "GET" ? null : await request.arrayBuffer(),
    headers: request.headers,
    method: request.method,
    signal: request.signal,
  });
};
