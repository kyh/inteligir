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
// The counts are a projection of the knowledge index, so a refresh is driven
// by that index's own push (`onKnowledgeUpdated`, which the sidebar group
// subscribes to) plus a read when the palette opens. The index pushes often —
// including progress ticks through a rebuild — so an unchanged list keeps its
// array identity and re-renders nothing.
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

// Sequence guard: two surfaces can refresh concurrently (a palette open racing
// the sidebar's index push), and a slow earlier response must not land over a
// newer one.
let refreshSeq = 0;

/** Same tags, same counts, same order. Compares the whole payload, so a count
 * moving on an otherwise-identical list still publishes. */
function sameTags(a: TagCount[], b: TagCount[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, i) => {
      const other = b[i];
      return other !== undefined && other.tag === entry.tag && other.count === entry.count;
    })
  );
}

/** Re-read the tag index. Fire-and-forget: a failed read leaves the last good
 * list in place — a stale count is better than an empty sidebar group. */
export function refreshTags(): void {
  const seq = ++refreshSeq;
  getBridge()
    .listTags()
    .then((tags) => {
      if (seq !== refreshSeq) return undefined;
      const state = useTags.getState();
      // Hold the array identity when nothing moved: the always-mounted palette
      // and the sidebar group both select `tags`, and a fresh array with
      // identical contents would re-render both for no visible change.
      if (state.loaded && sameTags(state.tags, tags)) return undefined;
      useTags.setState({ loaded: true, tags });
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
