import { setFrontmatterPinned } from "@repo/notes/markdown/frontmatter";
import { editFrontmatter } from "./item-frontmatter";
import type { FrontmatterEditOutcome } from "./item-frontmatter";
import type { RewriteNoteApi } from "./rewrite-note";

export type PinNoteApi = RewriteNoteApi;

export type PinNoteOutcome = FrontmatterEditOutcome;

// One edit behind Info, the card menu and the palette, down the two paths every frontmatter
// edit of Info's takes (`editFrontmatter`): the open item through its live editor, any other
// through the guarded rewrite, refused rather than merged when it moved underneath.
export const setNotePinned = async (
  api: RewriteNoteApi,
  path: string,
  pinned: boolean,
): Promise<PinNoteOutcome> =>
  await editFrontmatter(api, path, pinned ? "pin" : "unpin", (content) => {
    const next = setFrontmatterPinned(content, pinned);
    if (next === null) {
      return { kind: "invalid" };
    }
    return next === content ? { kind: "unchanged" } : { content: next, kind: "written" };
  });
