import { oneAtATime } from "@repo/client/one-at-a-time";
import { base64FromBytes, bytesFromBase64 } from "@repo/contract/bytes";
import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { installEditorHost, setLibraryTitles } from "@repo/editor/host-io";
import type { UnsentNote } from "@repo/contract/library/unsent-note";
import type { NoteStanding } from "@repo/editor/host-io";
import type { OpenNote } from "@repo/editor/item/item-editor";
import type { LibraryActions } from "./library-actions";

export type NoteState = "none" | "reading" | "editing";

export interface Settled {
  readonly ask: number;
  readonly holds: boolean;
}

interface NoteReports {
  readonly noteState: (state: NoteState) => void;
  readonly settled: (answer: Settled) => void;
}

export interface MovedItems {
  readonly seq: number;
  readonly ids: readonly string[] | null;
}

export interface PageProps extends LibraryActions, NoteReports {
  readonly itemId: string;
  readonly unsent: UnsentNote | null;
  readonly offline: boolean;
  readonly moved: MovedItems;
  readonly settle: number;
  readonly focus: boolean;
}

interface PageHost {
  readonly follow: (props: PageProps) => void;
  readonly noteIs: (note: OpenNote | null) => void;
}

const stateOf = (note: OpenNote | null) => {
  if (note === null) {
    return "none" as const;
  }

  return (note.unsaved() ? "editing" : "reading") satisfies NoteState;
};

const oneReadAtATime = (read: () => Promise<void>) =>
  oneAtATime(async () => {
    await Promise.allSettled([read()]);
  });

// oxlint-disable-next-line no-empty-function -- the touch profile draws no Ask agent, and a tag chip does nothing on the phone
const nothingToDo = () => {};

export const installPageHost = (first: PageProps) => {
  let props = first;
  let followed = false;
  let note: OpenNote | null = null;
  let stopNote = nothingToDo;
  let reported: NoteState | null = null;
  const reachListeners = new Set<() => void>();
  const followers = new Set<(standing: NoteStanding) => void>();

  const fileSrcs = new Map<string, Promise<string>>();

  const kept = new Map<string, UnsentNote>();
  const seeded = new Set<string>();

  const seed = (next: PageProps) => {
    if (seeded.has(next.itemId)) {
      return;
    }

    seeded.add(next.itemId);

    if (next.unsent !== null) {
      kept.set(next.itemId, next.unsent);
    }
  };

  seed(first);

  const srcOf = async (sha: string) => {
    const [made] = await Promise.allSettled([
      (async () => {
        const file = await props.readFile(sha);

        return file === null
          ? null
          : URL.createObjectURL(new Blob([bytesFromBase64(file.base64)], { type: file.mediaType }));
      })(),
    ]);

    if (made.status === "fulfilled" && made.value !== null) {
      return made.value;
    }

    fileSrcs.delete(sha);
    throw new Error("the phone holds no copy of this file now");
  };

  const readTargets = oneReadAtATime(async () => {
    setLibraryTitles(await props.linkTargets());
  });

  const readStanding = oneReadAtATime(async () => {
    const standing = await props.noteStanding(props.itemId);

    if (standing !== null) {
      for (const follower of followers) {
        follower(standing);
      }
    }
  });

  const report = () => {
    const state = stateOf(note);

    if (state !== reported) {
      reported = state;
      props.noteState(state);
    }
  };

  const answer = async (ask: number) => {
    const holds = note === null || (await note.holds());
    props.settled({ ask, holds });
  };

  installEditorHost({
    actions: {
      agent: { askAboutSelection: nothingToDo },
      items: {
        createNote: async (made) =>
          await props.createNote({ blocks: [...made.blocks], title: made.title }),
        showTag: nothingToDo,
      },
    },
    io: {
      fileMaxBytes: BLOB_MAX_BYTES,
      fileSrc: async (sha) => {
        const src = fileSrcs.get(sha) ?? srcOf(sha);
        fileSrcs.set(sha, src);

        return await src;
      },
      keepFile: async (bytes, mime) =>
        await props.keepFile({ base64: base64FromBytes(bytes), mediaType: mime }),
      notes: {
        follow: (_itemId, listener) => {
          followers.add(listener);

          return () => {
            followers.delete(listener);
          };
        },
        reach: {
          get: () => !props.offline,
          subscribe: (listener) => {
            reachListeners.add(listener);

            return () => {
              reachListeners.delete(listener);
            };
          },
        },
        read: async (itemId) => await props.readNote(itemId),
        save: async (save) => await props.saveNote(save),
        unsent: {
          read: (itemId) => kept.get(itemId) ?? null,
          write: (itemId, typed) => {
            if (typed === null) {
              kept.delete(itemId);
            } else {
              kept.set(itemId, typed);
            }

            void props.keepUnsent(itemId, typed).catch(nothingToDo);

            return true;
          },
        },
      },
      openItem: (itemId) => {
        props.openItem(itemId);
      },
      readFile: null,
      readItemBlocks: async (itemId) => await props.readItem(itemId),
    },
  });

  return {
    follow: (next) => {
      const before = props;
      props = next;

      seed(next);

      if (!followed) {
        followed = true;
        void readTargets();
      }

      if (next.offline !== before.offline) {
        for (const listener of reachListeners) {
          listener();
        }
      }

      if (next.moved.seq !== before.moved.seq) {
        const ids =
          next.moved.seq === before.moved.seq + 1 && next.moved.ids !== null
            ? new Set(next.moved.ids)
            : null;

        if (ids === null || [...ids].some((id) => id !== next.itemId)) {
          void readTargets();
        }

        if (ids === null || ids.has(next.itemId)) {
          void readStanding();
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
  } satisfies PageHost;
};
