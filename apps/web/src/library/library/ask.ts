// What a command asks the person before it acts: a name, a folder to move to, a tag to add or take
// off. One ask stands at a time, drawn by the one host the library's layout mounts
// (`./ask-dialog-host.tsx`) and answered once: an ask made over another dismisses it, and a
// dismissed ask answers null, so its command does nothing.

import { createStore } from "zustand/vanilla";

import type { TagChange } from "./library-verbs";

interface NameAsk {
  readonly title: string;
  readonly label: string;
  readonly initial: string;
  readonly confirm: string;
  // why this text can't be taken, which holds the dialog open on it
  readonly refuse?: (name: string) => string | null;
}

interface FolderAsk {
  // how many items move
  readonly count: number;
}

interface TagsAsk {
  readonly count: number;
  // the tags every subject carries now, which the dialog offers to take off
  readonly held: readonly string[];
}

// the folder picked, none being Unsorted
interface PickedFolder {
  readonly folderId: string | null;
}

type Answer<Value> = (value: Value | null) => void;

export type Ask =
  | (NameAsk & { readonly kind: "name"; readonly answer: Answer<string> })
  | (FolderAsk & { readonly kind: "folder"; readonly answer: Answer<PickedFolder> })
  | (TagsAsk & { readonly kind: "tags"; readonly answer: Answer<TagChange> });

interface Asks {
  readonly standing: Ask | null;
  // how many were made, which keys the host's form, so each ask draws with a draft of its own
  readonly made: number;
}

export const asks = createStore<Asks>()(() => ({ made: 0, standing: null }));

export const dismissAsk = (): void => {
  asks.getState().standing?.answer(null);
};

const asking = async <Value>(ask: (answer: Answer<Value>) => Ask): Promise<Value | null> =>
  // oxlint-disable-next-line promise/avoid-new -- the answer arrives from a press on the mounted host, so there is no upstream promise to return
  await new Promise<Value | null>((resolve) => {
    dismissAsk();
    const standing = ask((value) => {
      // a press on a form already leaving answers nothing, and closes no ask made since
      if (asks.getState().standing === standing) {
        asks.setState({ standing: null });
        resolve(value);
      }
    });
    asks.setState(({ made }) => ({ made: made + 1, standing }));
  });

export const askName = async (ask: NameAsk): Promise<string | null> =>
  await asking<string>((answer) => ({ ...ask, answer, kind: "name" }));

export const askFolder = async (ask: FolderAsk): Promise<PickedFolder | null> =>
  await asking<PickedFolder>((answer) => ({ ...ask, answer, kind: "folder" }));

export const askTags = async (ask: TagsAsk): Promise<TagChange | null> =>
  await asking<TagChange>((answer) => ({ ...ask, answer, kind: "tags" }));
