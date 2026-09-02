// Every expected failure is already a response, so a throw is a bug or an outage; without this
// line workerd's own 500 leaves nothing in `wrangler tail`. Workers Logs indexes the fields of a
// logged object. The search string is dropped: ?path= carries vault file names, ?state= a nonce.
export function logUnhandled(surface: string, request: Request, cause: unknown): void {
  console.error({
    event: "unhandled-error",
    surface,
    method: request.method,
    path: new URL(request.url).pathname,
    ...errorFields(cause),
  });
}

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
