// a store rather than a prop: the `#tag` chips live deep in the Plate tree with no route to
// the rail's owner. one-shot: the rail adopts the request, then clears it.

import { create } from "zustand";

type TagRequestState = { tag: string | null };

export const useTagRequest = create<TagRequestState>()(() => ({ tag: null }));

export function requestTagFilter(tag: string): void {
  useTagRequest.setState({ tag });
}

export function consumeTagRequest(): void {
  useTagRequest.setState({ tag: null });
}
