// What the note page asks of the library, which native answers (note-actions.ts). Types alone,
// apart from the page's host, so native code and the e2e's native end read the wire without the
// editor's graph.

import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import type { LinkTarget } from "@repo/editor/host-io";

interface FileBytes {
  readonly base64: string;
  readonly mediaType: string;
}

export interface LibraryActions {
  readonly socketTicket: () => Promise<string>;
  // an item's blocks as the cloud holds them, or as the phone last read them while there is no
  // connection; null for an item the library holds none of
  readonly readItem: (itemId: string) => Promise<LibraryBlock[] | null>;
  readonly linkTargets: () => Promise<LinkTarget[]>;
  // null while the phone can reach no copy of the file
  readonly readFile: (sha: string) => Promise<FileBytes | null>;
  readonly keepFile: (file: FileBytes) => Promise<{ sha: string }>;
  // made in the open item's folder; answers its id
  readonly createNote: (note: { title: string; blocks: LibraryBlock[] }) => Promise<string>;
  readonly openItem: (itemId: string) => void;
}
