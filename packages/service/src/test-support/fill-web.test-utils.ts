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

export const htmlPage = (html: string, status = 200) =>
  (() =>
    new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
      status,
    })) satisfies Route;

export const filePage = (bytes: Uint8Array<ArrayBuffer>, type: string) =>
  (() => new Response(bytes, { headers: { "content-type": type } })) satisfies Route;

export const redirect = (location: string, status = 302) =>
  (() => new Response(null, { headers: { location }, status })) satisfies Route;

export const pngOf = (width: number, height: number) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);

  return bytes;
};
