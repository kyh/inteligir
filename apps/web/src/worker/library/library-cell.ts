// Each account's library cell is one Durable Object, `library:<accountId>`, reached through the
// Worker's own export (`ctx.exports.LibraryDO`, no env binding). Naming an object creates it, so a
// cell is named only from an account id one of two sources vouches for: a credential the Worker
// verified, or a fill message (`../fill/fill-job`), which only a cell writes, from its own name,
// onto a queue only this Worker produces to and consumes. The cell reads its account back from its
// own name.

import type { LibraryDO } from "./library-do";

const CELL_NAME_PREFIX = "library:";

export const libraryCellName = (accountId: string): string => `${CELL_NAME_PREFIX}${accountId}`;

export const libraryCell = (
  exports: Cloudflare.Exports,
  accountId: string,
): DurableObjectStub<LibraryDO> => exports.LibraryDO.getByName(libraryCellName(accountId));

// the account a cell's name holds; a cell reached by any other name is a bug, never served
export const cellAccountId = (name: string | undefined): string => {
  if (name?.startsWith(CELL_NAME_PREFIX) !== true || name.length === CELL_NAME_PREFIX.length) {
    throw new Error("a library cell is named library:<accountId>");
  }
  return name.slice(CELL_NAME_PREFIX.length);
};
