// ---------------------------------------------------------------------------
// The Worker's one logging helper.
//
// Every EXPECTED failure in this Worker is already a value — a 401/403/404
// response, or a refusal body at HTTP 200. So an actual THROW is always a bug
// or an outage, and the fetch entry point funnels one into this single
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
export function logUnhandled(surface: string, request: Request, cause: unknown): void {
  console.error({
    event: "unhandled-error",
    surface,
    method: request.method,
    path: new URL(request.url).pathname,
    ...errorFields(cause),
  });
}

/** The two queryable fields a throw contributes to the line above. */
interface ErrorFields {
  message: string;
  stack: string | undefined;
}

function errorFields(cause: unknown): ErrorFields {
  return {
    message: cause instanceof Error ? cause.message : String(cause),
    stack: cause instanceof Error ? cause.stack : undefined,
  };
}
