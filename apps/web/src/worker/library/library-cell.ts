// Each account's library cell is one Durable Object, `library:<accountId>`, reached through the
// Worker's own export (`ctx.exports.LibraryDO`, no env binding), and named only from an account id
// a verified credential gave: naming an object creates it, so a name a caller chose would make
// one. The cell reads its account back from its own name.

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
