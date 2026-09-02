// a store rather than a prop: the `#tag` chips live deep in the Plate tree with no route to
// the palette's owner. one-shot: the palette adopts the request, then clears it.

import { create } from "zustand";

type SearchRequestState = { query: string | null };

export const useSearchRequest = create<SearchRequestState>()(() => ({ query: null }));

export function requestSearch(query: string): void {
  useSearchRequest.setState({ query });
}

export function consumeSearchRequest(): void {
  useSearchRequest.setState({ query: null });
}
