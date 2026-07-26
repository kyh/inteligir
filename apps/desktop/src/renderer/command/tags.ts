// ---------------------------------------------------------------------------
// Tags — the renderer's ONE tag data path and the seam into the palette's tag
// browser.
//
// Three surfaces show tags: the palette (`#` lists tags → a tag's notes), the
// sidebar's Tags group, and the editor's inline `#tag` chips. Only the first
// one owns any UI for it — `browseTag` is an internal palette PHASE, not an
// exported navigation API — so the other two ask for it here and the palette
// picks the request up. That keeps ONE tag list in memory (one `listTags` per
// refresh, shared) and ONE way to open a tag, instead of the sidebar and the
// chips each growing their own list rendering.
//
// The counts are a projection of note bodies, so they are refreshed on the
// same cadence the rest of the app discovers vault changes (see CLAUDE.md
// § Decisions, "ephemeral listing"): the palette refreshes on open, the
// sidebar group on a structural listing change and on a completed save. There
// is deliberately no subscription/push channel for tags.
// ---------------------------------------------------------------------------

import { create } from "zustand";

import type { TagCount } from "@repo/notes/knowledge/tag-index";

import { getBridge } from "@renderer/lib/bridge";

/** What an outside surface asks the palette to show. A discriminated union
 * rather than `string | null`: "show every tag" and "show THIS tag's notes"
 * are different destinations, and `""` must never accidentally mean one.
 * Not exported — callers go through `browseTag`/`openTagList`, which is the
 * only way the union stays impossible to construct wrong. */
type TagRequest = { kind: "list" } | { kind: "browse"; tag: string };

type TagsState = {
  /** Every tag with its note count, most-used first (the index's ordering). */
  tags: TagCount[];
  /** False until the first `listTags` lands — lets a surface distinguish
   * "no tags in this vault" from "haven't asked yet". */
  loaded: boolean;
  /** A pending navigation request, cleared by the palette once honored. */
  request: TagRequest | null;
};

export const useTags = create<TagsState>()(() => ({ loaded: false, request: null, tags: [] }));

// Sequence guard: two surfaces can refresh concurrently (palette open while
// the sidebar reacts to a save), and a slow earlier response must not land
// over a newer one.
let refreshSeq = 0;

/** Re-read the tag index. Fire-and-forget: a failed read leaves the last good
 * list in place — a stale count is better than an empty sidebar group. */
export function refreshTags(): void {
  const seq = ++refreshSeq;
  getBridge()
    .listTags()
    .then((tags) => {
      if (seq === refreshSeq) useTags.setState({ loaded: true, tags });
      return undefined;
    })
    .catch(() => {});
}

/** Open the palette on this tag's note list (sidebar row, inline chip). */
export function browseTag(tag: string): void {
  useTags.setState({ request: { kind: "browse", tag } });
}

/** Open the palette on the full tag list (the sidebar's "Show all tags"). */
export function openTagList(): void {
  useTags.setState({ request: { kind: "list" } });
}

/** Palette-only: mark the pending request as honored. */
export function consumeTagRequest(): void {
  useTags.setState({ request: null });
}
