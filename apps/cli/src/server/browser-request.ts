// IS THIS COOKIE-AUTHED REQUEST ACTUALLY FROM THIS SERVER'S OWN PAGE?
//
// A COOKIE IS AMBIENT AUTHORITY. The browser attaches the session cookie to
// every same-SITE request by itself — and on loopback "site" IGNORES the port,
// so a page served from `http://127.0.0.1:<any other port>` (a co-resident
// local dev tool, a second app's server) is same-site with this one, and its
// requests carry this server's cookie. CORS keeps the attacker from READING the
// response, but a no-cors POST to `/rpc` still FIRES — enough to write, delete
// or rename by path, or to plant a note a later agent turn executes.
//
// The bearer has no such problem: only a process that could READ the data dir
// ever holds it, so a page cannot present one. That is why this assertion is
// scoped to the cookie carrier alone — the bearer path is trusted as-is.
//
// `Sec-Fetch-Site` is the precise signal and every current browser sends it:
// `same-origin` is the SPA's own fetch/ws, `none` is a user-typed navigation;
// `same-site` and `cross-site` are exactly the co-resident attacker. When it is
// absent (a client too old to send it, or a websocket handshake that omits it),
// fall back to an explicit `Origin` match against the host the request reached —
// which a state-changing no-cors request always carries. A cookie-authed
// request that proves neither is refused.

export interface BrowserRequestHeaders {
  secFetchSite: string | undefined;
  origin: string | undefined;
  /** The `Host` the request reached — the port that answered, which a probed
   *  dev bind may have moved off the configured value. */
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
  // This server binds plain-http loopback only, so its own origin is exactly
  // `http://<host>` — scheme and port included in the host authority.
  return headers.origin === `http://${headers.host}`;
}
