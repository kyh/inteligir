// A library row in is-hotkey's spelling, so the suites compare it with a global or editor row as
// one chord: the library's listeners read their table's keys themselves, and spell none.

import type { LibraryShortcut } from "../library/library-keys";

export const libraryShortcutHotkey = (row: LibraryShortcut): string =>
  `${row.mod === true ? "mod+" : ""}${row.shift === true ? "shift+" : ""}${row.key}`;
