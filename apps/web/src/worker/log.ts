interface ErrorFields {
  message: string;
  stack: string | undefined;
  // what each wrapper wrapped, outermost first: a Drizzle "Failed query" names the SQL, and only
  // its cause says what D1 answered
  causes: string[];
}

// a cycle of causes is cut at this depth, which no real chain reaches
const CAUSE_DEPTH = 8;

export const errorFields = (cause: unknown): ErrorFields => {
  const causes: string[] = [];
  let next = cause instanceof Error ? cause.cause : undefined;
  while (next !== undefined && causes.length < CAUSE_DEPTH) {
    causes.push(next instanceof Error ? `${next.name}: ${next.message}` : String(next));
    next = next instanceof Error ? next.cause : undefined;
  }
  return {
    message: cause instanceof Error ? cause.message : String(cause),
    stack: cause instanceof Error ? cause.stack : undefined,
    causes,
  };
};

// Every expected failure is already a response, so a throw is a bug or an outage; without this
// line workerd's own 500 leaves nothing in `wrangler tail`. Workers Logs indexes the fields of a
// logged object. The search string is dropped: a query string may carry a path or token.
export const logUnhandled = (surface: string, request: Request, cause: unknown): void => {
  console.error({
    event: "unhandled-error",
    method: request.method,
    path: new URL(request.url).pathname,
    surface,
    ...errorFields(cause),
  });
};
