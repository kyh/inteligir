// The web as a fill's suite serves it: each address a route, every other one a 404, asked through the
// hop fetch the guarded read takes in place of the network, every hop kept in order with what it was
// asked with.

import type { HopFetch } from "../fill/page-fetch";

export type Route = () => Response | Promise<Response>;

interface Asked {
  readonly url: string;
  readonly headers: Headers;
  readonly redirect: string;
}

export const serveWeb = (routes: Readonly<Record<string, Route>>) => {
  const asked: Asked[] = [];
  const fetch: HopFetch = async (url, init) => {
    asked.push({ headers: new Headers(init.headers), redirect: init.redirect, url });
    init.signal.throwIfAborted();
    const route = routes[url];
    return route === undefined ? new Response("missing", { status: 404 }) : await route();
  };
  return { asked, fetch };
};

export const htmlPage =
  (html: string, status = 200): Route =>
  () =>
    new Response(html, { headers: { "content-type": "text/html; charset=utf-8" }, status });

export const filePage =
  (bytes: Uint8Array<ArrayBuffer>, type: string): Route =>
  () =>
    new Response(bytes, { headers: { "content-type": type } });

export const redirect =
  (location: string, status = 302): Route =>
  () =>
    new Response(null, { headers: { location }, status });

// a PNG's signature and header naming its size, which is all the reading looks at
export const pngOf = (width: number, height: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
};
