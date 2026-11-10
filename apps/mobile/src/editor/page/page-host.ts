// The editor's host inside the phone's DOM component (note-page.tsx). The page reaches the library
// only through the phone: every read and write is an action native answers (note-actions.ts), each
// argument and answer JSON and bytes base64, and the one connection the page opens is the note's
// socket, on a ticket an action fetched. Native speaks to the page only through its props, which the
// page hands the host after every render: whether there is a connection, which items moved, and a
// leave's ask. Expo hands the page new action functions on every native render, so the host calls
// the ones it was handed last.

import { base64FromBytes, bytesFromBase64 } from "@repo/contract/bytes";
import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { notePath } from "@repo/contract/library/library-socket";
import { installEditorHost, setLibraryTitles } from "@repo/editor/host-io";
import type { LinkTarget } from "@repo/editor/host-io";
import { noteHolds } from "@repo/editor/item/note-holds";
import type { LeavingNote } from "@repo/editor/item/note-holds";

interface FileBytes {
  readonly base64: string;
  readonly mediaType: string;
}

// what the page asks of the library, answered by the phone
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

// where the open note stands for a leave: `editing` while an edit made here may not be held yet
export type NoteState = "none" | "reading" | "editing";

// the page's answer to a leave's ask, by the ask's count
export interface Settled {
  readonly ask: number;
  readonly holds: boolean;
}

// what the page tells the phone on its own
interface NoteReports {
  readonly noteState: (state: NoteState) => void;
  readonly settled: (answer: Settled) => void;
}

// a signal native moves each time the account's socket says items moved: the ids, or null when any
// may have
export interface MovedItems {
  readonly seq: number;
  readonly ids: readonly string[] | null;
}

export interface PageProps extends LibraryActions, NoteReports {
  readonly itemId: string;
  // the cloud's origin, which the note's socket dials
  readonly cloudOrigin: string;
  // no connection, or the app is behind, where iOS suspends the page's socket
  readonly offline: boolean;
  readonly moved: MovedItems;
  // a leave's ask, a count native moves; the page answers each with `settled`
  readonly settle: number;
  // the caret goes to the end of the note's body once it opens, and the keyboard comes up
  readonly focus: boolean;
}

export interface PageHost {
  // the page's props, handed over after every render
  readonly follow: (props: PageProps) => void;
  // the open note, as the item editor announces it
  readonly noteIs: (note: LeavingNote | null) => void;
}

const stateOf = (note: LeavingNote | null): NoteState => {
  if (note === null) {
    return "none";
  }
  const status = note.status();
  if (status.kind !== "open") {
    return "none";
  }
  return status.held === null && (status.live || note.unsent()) ? "editing" : "reading";
};

// one read at a time, the last signal it missed read once it ends; a read that fails waits for the
// next signal, and a link shows the title it was written with meanwhile
const oneReadAtATime = (read: () => Promise<void>): (() => Promise<void>) => {
  let reading = false;
  let readAgain = false;
  const run = async (): Promise<void> => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      await read();
    } catch {
      // the next signal asks again
    } finally {
      reading = false;
    }
    if (readAgain) {
      readAgain = false;
      await run();
    }
  };
  return run;
};

const nothingToDo = (): void => {
  /* the touch profile draws no Ask agent, and a tag chip does nothing on the phone */
};

export const installPageHost = (first: PageProps): PageHost => {
  let props = first;
  let followed = false;
  let note: LeavingNote | null = null;
  let stopNote = nothingToDo;
  let reported: NoteState | null = null;
  const offlineListeners = new Set<() => void>();
  const itemListeners = new Set<(ids: ReadonlySet<string> | null) => void>();

  const readTargets = oneReadAtATime(async () => {
    setLibraryTitles(await props.linkTargets());
  });

  const report = (): void => {
    const state = stateOf(note);
    if (state !== reported) {
      reported = state;
      props.noteState(state);
    }
  };

  const answer = async (ask: number): Promise<void> => {
    const holds = note === null || (await noteHolds(note));
    props.settled({ ask, holds });
  };

  installEditorHost({
    actions: {
      agent: { askAboutSelection: nothingToDo, showTag: nothingToDo },
      items: {
        createNote: async (made) =>
          await props.createNote({ blocks: [...made.blocks], title: made.title }),
      },
    },
    io: {
      fileMaxBytes: BLOB_MAX_BYTES,
      keepFile: async (bytes, mime) =>
        await props.keepFile({ base64: base64FromBytes(bytes), mediaType: mime }),
      notes: {
        notePath,
        offline: () => props.offline,
        onOfflineChange: (listener) => {
          offlineListeners.add(listener);
          return () => {
            offlineListeners.delete(listener);
          };
        },
        socketOrigin: first.cloudOrigin,
        socketTicket: async () => await props.socketTicket(),
      },
      onItemsChanged: (listener) => {
        itemListeners.add(listener);
        return () => {
          itemListeners.delete(listener);
        };
      },
      openItem: (itemId) => {
        props.openItem(itemId);
      },
      readFile: async (sha) => {
        const file = await props.readFile(sha);
        if (file === null) {
          throw new Error("the phone holds no copy of this file now");
        }
        return new Blob([bytesFromBase64(file.base64)], { type: file.mediaType });
      },
      readItemBlocks: async (itemId) => await props.readItem(itemId),
      savesFiles: false,
    },
  });

  return {
    follow: (next) => {
      const before = props;
      props = next;
      if (!followed) {
        followed = true;
        void readTargets();
      }
      if (next.offline !== before.offline) {
        for (const listener of offlineListeners) {
          listener();
        }
      }
      if (next.moved.seq !== before.moved.seq) {
        // a signal the page never saw may have named any item
        const ids =
          next.moved.seq === before.moved.seq + 1 && next.moved.ids !== null
            ? new Set(next.moved.ids)
            : null;
        for (const listener of itemListeners) {
          listener(ids);
        }
        if (ids === null || [...ids].some((id) => id !== next.itemId)) {
          void readTargets();
        }
      }
      if (next.settle !== before.settle) {
        void answer(next.settle);
      }
    },
    noteIs: (next) => {
      stopNote();
      note = next;
      stopNote = next?.subscribe(report) ?? nothingToDo;
      report();
    },
  };
};
