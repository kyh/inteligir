// The sentence a refusal the contract declares carries, which is written for the person; any other
// failure (no answer, a fault of the cloud's) is said by the screen's own fallback, never in the
// words of the error it raised, as the library's page says it.

import { ORPCError } from "@orpc/client";

export const refusalText = (cause: unknown, fallback: string): string =>
  cause instanceof ORPCError && cause.defined && cause.message.length > 0
    ? cause.message
    : fallback;
