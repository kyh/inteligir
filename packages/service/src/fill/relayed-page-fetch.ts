// The e2e's stand-in for the web, which a deployment never takes: with `PAGE_FETCH_RELAY_URL` set
// off Vercel, each page the app fetches (a fill's every hop, an assistant's metadata document) is
// asked of the relay as `GET <relay>?url=<the address>`, past the fill's dispatcher, since the relay
// answers only the test's own pages at names no resolver answers.

import { env } from "../env";

const relayed =
  (relay: string) =>
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const asked = new Request(input, init);
    const url = new URL(relay);
    url.searchParams.set("url", asked.url);
    return await fetch(url, { headers: asked.headers, signal: asked.signal });
  };

// the relay's fetch when one is set off Vercel, else null
export const RELAYED_FETCH =
  env.PAGE_FETCH_RELAY_URL !== undefined && process.env.VERCEL !== "1"
    ? relayed(env.PAGE_FETCH_RELAY_URL)
    : null;
