// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { customAlphabet } from "nanoid";

// lowercase alphanumerics minus the look-alikes (0/o, 1/l/i).
export const GENERATED_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
export const GENERATED_ID_SUFFIX_LENGTH = 10;

const generateIdSuffix = customAlphabet(GENERATED_ID_ALPHABET, GENERATED_ID_SUFFIX_LENGTH);

export function createPrefixedId(prefix: string): string {
  return `${prefix}_${generateIdSuffix()}`;
}

export function createThreadId(): string {
  return createPrefixedId("thr");
}

export function createEventId(): string {
  return createPrefixedId("evt");
}

export function createTurnId(): string {
  return createPrefixedId("turn");
}

export function createQueuedThreadMessageId(): string {
  return createPrefixedId("qmsg");
}

export function createPendingInteractionId(): string {
  return createPrefixedId("pint");
}

export function createSyncOutboxId(): string {
  return createPrefixedId("obx");
}
