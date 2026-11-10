// The sentence a refusal `/v1` declares carries, which is written for the person (v1-errors.ts);
// any other failure (no answer, a fault of the cloud's) is said by the screen's own fallback, never
// in the words of the error it raised. One rule for every device, so the Mac, the tab and the phone
// say one thing of one refusal.

import { isOrpcError } from "./v1-errors";

export const refusalText = (cause: unknown, fallback: string): string =>
  isOrpcError(cause) && cause.defined && cause.message.length > 0 ? cause.message : fallback;
