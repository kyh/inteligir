import { tagInFamily } from "./rename-tags";
import type { TagCount } from "./tag-index";

export interface TagNotesSource {
  tags(): TagCount[];
  notesWithTag(tag: string): string[];
}

// A tag names its family: `a` lists the notes under `a/x` too, the way the rail folds them and
// the rename moves them. Sorted by path so a page is the same page on the next call.
export function notesInTagFamily(source: TagNotesSource, tag: string): string[] {
  const paths = new Set<string>();
  for (const { tag: candidate } of source.tags()) {
    if (!tagInFamily(candidate, tag)) continue;
    for (const path of source.notesWithTag(candidate)) paths.add(path);
  }
  return [...paths].toSorted();
}
