import type { HeldNote, NoteSave, NoteSaved } from "@repo/contract/library/held-note";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import type { LinkTarget, NoteStanding } from "@repo/editor/host-io";

interface FileBytes {
  readonly base64: string;
  readonly mediaType: string;
}

export interface LibraryActions {
  readonly readNote: (itemId: string) => Promise<HeldNote | null>;
  readonly saveNote: (save: NoteSave) => Promise<NoteSaved>;
  readonly noteStanding: (itemId: string) => Promise<NoteStanding | null>;
  readonly readItem: (itemId: string) => Promise<LibraryBlock[] | null>;
  readonly linkTargets: () => Promise<LinkTarget[]>;
  readonly readFile: (sha: string) => Promise<FileBytes | null>;
  readonly keepFile: (file: FileBytes) => Promise<{ sha: string }>;
  readonly createNote: (note: { title: string; blocks: LibraryBlock[] }) => Promise<string>;
  readonly openItem: (itemId: string) => void;
}
