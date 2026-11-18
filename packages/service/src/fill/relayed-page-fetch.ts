import { env } from "../env";

const relayed = (relay: string) => async (input: string | URL | Request, init?: RequestInit) => {
  const asked = new Request(input, init);
  const url = new URL(relay);
  url.searchParams.set("url", asked.url);

  return await fetch(url, { headers: asked.headers, signal: asked.signal });
};

export const RELAYED_FETCH =
  env.PAGE_FETCH_RELAY_URL !== undefined && process.env.VERCEL !== "1"
    ? relayed(env.PAGE_FETCH_RELAY_URL)
    : null;
