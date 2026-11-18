import { inspect } from "node:util";

import { DrizzleQueryError } from "drizzle-orm";

interface ErrorFields {
  name: string | undefined;
  message: string;
  stack: string | undefined;
  causes: string[];
}

const CAUSE_DEPTH = 8;

const MESSAGE_MAX = 300;

const clipped = (text: string) =>
  text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX)}…` : text;

const STACK_FRAME = /^\s+at .+$/gmu;

const messageOf = (error: Error) =>
  error instanceof DrizzleQueryError ? `Failed query: ${error.query}` : error.message;

const spelled = (cause: unknown) =>
  cause instanceof Error ? messageOf(cause) : inspect(cause, { breakLength: Infinity });

export const errorFields = (cause: unknown) => {
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
  } satisfies ErrorFields;
};

export const logUnhandled = (request: Request, cause: unknown) => {
  console.error({
    event: "unhandled-error",
    method: request.method,
    path: new URL(request.url).pathname,
    ...errorFields(cause),
  });
};
