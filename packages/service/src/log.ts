import { inspect } from "node:util";

import { DrizzleQueryError } from "drizzle-orm";

interface ErrorFields {
  name: string | undefined;
  message: string;
  stack: string | undefined;
  // what each wrapper wrapped, outermost first: a Drizzle "Failed query" names the SQL, and only
  // its cause says what Postgres answered
  causes: string[];
}

// a cycle of causes is cut at this depth, which no real chain reaches
const CAUSE_DEPTH = 8;

// a message may quote its input (JSON.parse names the text it failed on), so each keeps only its
// opening
const MESSAGE_MAX = 300;

const clipped = (text: string): string =>
  text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX)}…` : text;

// a stack opens with the whole message, so only its frames are kept
const STACK_FRAME = /^\s+at .+$/gmu;

// a failed query's message ends with its parameters, which are the library's own words (a title,
// a url, a block's text); the statement alone says which query failed
const messageOf = (error: Error): string =>
  error instanceof DrizzleQueryError ? `Failed query: ${error.query}` : error.message;

const spelled = (cause: unknown): string =>
  cause instanceof Error ? messageOf(cause) : inspect(cause, { breakLength: Infinity });

export const errorFields = (cause: unknown): ErrorFields => {
  const causes: string[] = [];
  let next = cause instanceof Error ? cause.cause : undefined;
  while (next !== undefined && causes.length < CAUSE_DEPTH) {
    causes.push(clipped(next instanceof Error ? `${next.name}: ${spelled(next)}` : spelled(next)));
    next = next instanceof Error ? next.cause : undefined;
  }
  return {
    name: cause instanceof Error ? cause.name : undefined,
    message: clipped(spelled(cause)),
    stack: cause instanceof Error ? cause.stack?.match(STACK_FRAME)?.join("\n") : undefined,
    causes,
  };
};

// Every expected failure is already a response, so a throw is a bug or an outage, logged with its
// request. The query string is dropped: it may carry a path or a token.
export const logUnhandled = (request: Request, cause: unknown): void => {
  console.error({
    event: "unhandled-error",
    method: request.method,
    path: new URL(request.url).pathname,
    ...errorFields(cause),
  });
};
