import { DrizzleQueryError } from "drizzle-orm";

interface ErrorFields {
  name: string | undefined;
  message: string;
  stack: string | undefined;
  // what each wrapper wrapped, outermost first: a Drizzle "Failed query" names the SQL, and only
  // its cause says what D1 answered
  causes: string[];
}

// a cycle of causes is cut at this depth, which no real chain reaches
const CAUSE_DEPTH = 8;

// the log keeps a week of what it is given, and a message may quote its input (JSON.parse names the
// text it failed on), so each message keeps only its opening
const MESSAGE_MAX = 300;

const clipped = (text: string): string =>
  text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX)}…` : text;

// a stack opens with the whole message, so only its frames are kept
const STACK_FRAME = /^\s+at .+$/gmu;

// a failed query's message ends with its parameters, which are the library's own words (a title,
// a url, a block's text); the statement alone says which query failed
const messageOf = (error: Error): string =>
  error instanceof DrizzleQueryError ? `Failed query: ${error.query}` : error.message;

export const errorFields = (cause: unknown): ErrorFields => {
  const causes: string[] = [];
  let next = cause instanceof Error ? cause.cause : undefined;
  while (next !== undefined && causes.length < CAUSE_DEPTH) {
    // oxlint-disable-next-line typescript/no-base-to-string -- a cause that is no Error is logged as whatever it spells; nothing narrower is known of it
    causes.push(clipped(next instanceof Error ? `${next.name}: ${messageOf(next)}` : String(next)));
    next = next instanceof Error ? next.cause : undefined;
  }
  return {
    name: cause instanceof Error ? cause.name : undefined,
    message: clipped(cause instanceof Error ? messageOf(cause) : String(cause)),
    stack: cause instanceof Error ? cause.stack?.match(STACK_FRAME)?.join("\n") : undefined,
    causes,
  };
};

// Every expected failure is already a response, so a throw is a bug or an outage; without this
// line workerd's own 500 leaves nothing in `wrangler tail`. Workers Logs indexes the fields of a
// logged object. The search string is dropped: a query string may carry a path or token.
export const logUnhandled = (request: Request, cause: unknown): void => {
  console.error({
    event: "unhandled-error",
    method: request.method,
    path: new URL(request.url).pathname,
    ...errorFields(cause),
  });
};
