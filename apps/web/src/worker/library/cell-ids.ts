// The ids the cell mints itself, from Web Crypto's random bytes
// (https://developers.cloudflare.com/workers/runtime-apis/web-crypto/): an item an agent or a
// save makes is a UUID version 7, as a device's own are, so ids sort by when they were made
// (RFC 9562 § 5.7), and so is a thread of the built-in agent's; a block an import or an edit reads
// is any unique id the vocabulary takes; a change set's, and a send waiting for the agent's turn, is
// a random UUID.

import { uuidV7 } from "@repo/notes/library/uuid-v7";

export interface CellIds {
  readonly item: () => string;
  readonly block: () => string;
  readonly changeSet: () => string;
  readonly thread: () => string;
  readonly queuedSend: () => string;
}

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

export const cellIds = (now: () => number): CellIds => ({
  block: () => crypto.randomUUID(),
  changeSet: () => crypto.randomUUID(),
  item: () => uuidV7(now(), randomBytes(16)),
  queuedSend: () => crypto.randomUUID(),
  thread: () => uuidV7(now(), randomBytes(16)),
});
