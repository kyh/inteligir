// What the window itself is dragging: cards or a folder row, by path. It is the one source a drop
// reads to tell a move from a save, because `dataTransfer` from the desktop carries files and
// links too: a drop with nothing here came from outside, and is saved, never moved.

import { createStore } from "zustand/vanilla";

export interface InternalDrag {
  readonly paths: readonly string[];
}

const dragStore = createStore<InternalDrag | null>()(() => null);

export const startInternalDrag = (paths: readonly string[]): void => {
  dragStore.setState({ paths }, true);
};

export const endInternalDrag = (): void => {
  dragStore.setState(null, true);
};

// read at the drop, never across an await
export const internalDrag = (): InternalDrag | null => dragStore.getState();
