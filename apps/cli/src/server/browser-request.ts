// cookie-authed requests only: on loopback "site" ignores the port, so a page on
// any other 127.0.0.1 port is same-site and its no-cors POST carries this
// server's cookie. sec-fetch-site is the signal; without it, origin must match
// the host that answered. the bearer needs none of this — only a reader of the
// data dir holds it.

export interface BrowserRequestHeaders {
  secFetchSite: string | undefined;
  origin: string | undefined;
  /** the host that answered, not the configured bind — a probed dev bind may have moved. */
  host: string | undefined;
}

export function isSameOriginBrowserRequest(headers: BrowserRequestHeaders): boolean {
  const site = headers.secFetchSite;
  if (site !== undefined) {
    return site === "same-origin" || site === "none";
  }
  if (headers.origin === undefined || headers.host === undefined) {
    return false;
  }
  // plain-http loopback only, so the origin is http://<host> with the port inside host.
  return headers.origin === `http://${headers.host}`;
}
