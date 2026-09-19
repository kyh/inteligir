// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { customAlphabet } from "nanoid";

// lowercase alphanumerics minus the look-alikes (0/o, 1/l/i).
export const GENERATED_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
export const GENERATED_ID_SUFFIX_LENGTH = 10;

const generateIdSuffix = customAlphabet(GENERATED_ID_ALPHABET, GENERATED_ID_SUFFIX_LENGTH);

export const createPrefixedId = (prefix: string): string => `${prefix}_${generateIdSuffix()}`;

export const createThreadId = (): string => createPrefixedId("thr");

export const createEventId = (): string => createPrefixedId("evt");

export const createTurnId = (): string => createPrefixedId("turn");

export const createQueuedThreadMessageId = (): string => createPrefixedId("qmsg");

export const createPendingInteractionId = (): string => createPrefixedId("pint");

export const createSyncOutboxId = (): string => createPrefixedId("obx");
