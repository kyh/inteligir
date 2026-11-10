// A note's object is named `note:<accountId>:<itemId>` and reached through the Worker's own export
// (`ctx.exports.NoteDO`, no env binding). Naming an object creates it, so only a caller holding a
// verified account names one: the account's cell, for an item its rows hold, and the note's door,
// for the account its ticket verified. This module is the one place the name is spelled, importable
// from those alone (oxlint.config.ts); the object reads its account and item back from its name.
// Each call that reads the document starts the object's server itself (`NoteDO`), so a plain stub
// serves, whatever evicted the object between two calls.

import type { NoteDO } from "./note-do";

const NOTE_PREFIX = "note:";

export interface NoteName {
  readonly accountId: string;
  readonly itemId: string;
}

const noteObjectName = ({ accountId, itemId }: NoteName): string =>
  `${NOTE_PREFIX}${accountId}:${itemId}`;

export const noteStub = (exports: Cloudflare.Exports, name: NoteName): DurableObjectStub<NoteDO> =>
  exports.NoteDO.getByName(noteObjectName(name));

// the account and item a note's own name gives; null for a name this module never spelled
export const noteNameOf = (name: string): NoteName | null => {
  if (!name.startsWith(NOTE_PREFIX)) {
    return null;
  }
  const [accountId, itemId, ...rest] = name.slice(NOTE_PREFIX.length).split(":");
  return accountId === undefined || itemId === undefined || rest.length > 0
    ? null
    : { accountId, itemId };
};
