import { createStore } from "zustand/vanilla";

import type { TagChange } from "./library-verbs";

interface NameAsk {
  readonly title: string;
  readonly label: string;
  readonly initial: string;
  readonly confirm: string;
  readonly refuse?: (name: string) => string | null;
}

interface FolderAsk {
  readonly count: number;
}

interface TagsAsk {
  readonly count: number;
  readonly held: readonly string[];
}

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
  readonly made: number;
}

export const asks = createStore<Asks>()(() => ({ made: 0, standing: null }));

export const dismissAsk = () => {
  asks.getState().standing?.answer(null);
};

const asking = async <Value>(ask: (answer: Answer<Value>) => Ask) =>
  // oxlint-disable-next-line promise/avoid-new -- the answer arrives from a press on the mounted host, so there is no upstream promise to return
  await new Promise<Value | null>((resolve) => {
    dismissAsk();

    const standing = ask((value) => {
      if (asks.getState().standing === standing) {
        asks.setState({ standing: null });
        resolve(value);
      }
    });

    asks.setState(({ made }) => ({ made: made + 1, standing }));
  });

export const askName = async (ask: NameAsk) =>
  await asking<string>((answer) => ({ ...ask, answer, kind: "name" }));

export const askFolder = async (ask: FolderAsk) =>
  await asking<PickedFolder>((answer) => ({ ...ask, answer, kind: "folder" }));

export const askTags = async (ask: TagsAsk) =>
  await asking<TagChange>((answer) => ({ ...ask, answer, kind: "tags" }));
