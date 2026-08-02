// ---------------------------------------------------------------------------
// "Open the palette on this query" — the one seam every surface that wants to
// search uses: the `inteligir://…?search=` deep link and the editor's inline
// `#tag` chips (which seed `tag:<name>`, the search box's own grammar).
//
// A store rather than a prop: the chips live deep inside the Plate tree, which
// has no route to the palette's owner, and there is exactly one palette per
// window. The request is one-shot — the palette adopts it, then clears it —
// so a later ⌘K opens on an empty box.
// ---------------------------------------------------------------------------

import { create } from "zustand";

type SearchRequestState = { query: string | null };

export const useSearchRequest = create<SearchRequestState>()(() => ({ query: null }));

/** Ask the palette to open on this query (verbatim — `tag:` and all). */
export function requestSearch(query: string): void {
  useSearchRequest.setState({ query });
}

/** Palette-only: mark the pending request as honored. */
export function consumeSearchRequest(): void {
  useSearchRequest.setState({ query: null });
}
