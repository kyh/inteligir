import { HARNESS_NAMES } from "@repo/domain/harness";
import type { HarnessId } from "@repo/domain/harness";
import type { ProviderFailure } from "@repo/domain/provider-event";

// a turn the vendor refused for the plan's usage limit or a sign-in would refuse the next message
// the same way, so a settle on one leaves the queue for the user's next send rather than draining
// into the same failure: the send starts the oldest queued message first.
export const QUEUE_HOLDING_FAILURES: ReadonlySet<ProviderFailure> = new Set([
  "auth",
  "usage-limit",
]);

// what a refused turn's error says, written here because the words promise what the queue rule
// above does; a class with nothing to promise keeps the adapter's words.
export const providerFailureMessage = (
  failure: ProviderFailure,
  harness: HarnessId,
  adapterMessage: string,
): string => {
  const { displayName } = HARNESS_NAMES[harness];
  switch (failure) {
    case "auth": {
      return `${displayName} is signed out on this Mac.`;
    }
    case "usage-limit": {
      return `${displayName} says you've reached your plan's usage limit. Your queued messages will wait until you send again.`;
    }
    case "overloaded":
    case "context":
    case "other": {
      return adapterMessage;
    }
    // no default
  }
};
