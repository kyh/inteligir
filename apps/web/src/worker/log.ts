// ---------------------------------------------------------------------------
// The Worker's one logging helper.
//
// Every EXPECTED failure in this Worker is already a value — a 401/403/404
// response, or an `{ok:false}` body at HTTP 200 (the version-conflict / bad-code
// convention). So an actual THROW is always a bug or an outage, and both fetch
// entry points (the Worker and the Durable Object) funnel one into this single
// structured line. Without it workerd's own unhandled-exception 500 carries no
// log line at all, and a `wrangler tail` shows nothing to correlate.
// ---------------------------------------------------------------------------

/**
 * Log one unhandled throw. Workers Logs indexes the fields of a logged object,
 * so `surface` / `method` / `path` are queryable in the dashboard.
 *
 * The URL's SEARCH string is deliberately dropped: `?path=` carries vault file
 * names and `?state=` carries a sign-in nonce — neither belongs in a log.
 */
export function logUnhandled(surface: string, request: Request, error: unknown): void {
  console.error({
    event: "unhandled-error",
    surface,
    method: request.method,
    path: new URL(request.url).pathname,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}
