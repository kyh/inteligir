// The Recent view scoped to a tag, which a `#tag` chip asks for: the tag's paged listing under
// its scope row, and the rename dialog. Mounted only while a tag is selected, so its query is
// armed only then.

import { Button } from "@repo/ui/components/button";
import { renamedTag } from "@repo/notes/knowledge/rename-tags";
import {
  KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT,
  KNOWLEDGE_TAG_NOTES_MAX_LIMIT,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { useMemo, useState } from "react";
import { useNotesWithTag } from "../vault-hooks";
import { NotesList } from "./notes-list";
import { RenameTagDialog, TagScopeHeader } from "./tag-scope";

export interface TaggedNotesProps {
  // owned by the workspace: a `#tag` chip anywhere in the note sets it
  tag: string;
  onSelectTag: (tag: string | null) => void;
  entries: readonly VaultEntry[];
  openPath: string | null;
  onOpenFile: (path: string) => void;
  onSetPinned: (path: string, pinned: boolean) => void;
}

// One page that grows: the list is re-read whole rather than stitched, since the drawn list is
// recency-sorted afterwards. Keyed on the tag by the rail, so a new tag
// starts at the first page without a reset in userland.
export const TaggedNotes = ({
  tag,
  onSelectTag,
  entries,
  openPath,
  onOpenFile,
  onSetPinned,
}: TaggedNotesProps) => {
  const [limit, setLimit] = useState(KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT);
  const [renaming, setRenaming] = useState(false);
  const taggedQuery = useNotesWithTag(tag, limit);
  const taggedPaths = useMemo(() => new Set(taggedQuery.data?.paths), [taggedQuery.data]);
  const taggedEntries = useMemo(
    () => entries.filter((entry) => entry.kind === "file" && taggedPaths.has(entry.path)),
    [entries, taggedPaths],
  );
  const cut =
    taggedQuery.data !== undefined && taggedQuery.data.paths.length < taggedQuery.data.total;
  return (
    <>
      <TagScopeHeader
        tag={tag}
        count={
          taggedQuery.data === undefined
            ? undefined
            : { listed: taggedQuery.data.paths.length, total: taggedQuery.data.total }
        }
        onClear={() => {
          onSelectTag(null);
        }}
        onRename={() => {
          setRenaming(true);
        }}
      />
      <NotesList
        entries={taggedEntries}
        openPath={openPath}
        onOpenFile={onOpenFile}
        emptyText={taggedQuery.data === undefined ? "…" : `No notes tagged #${tag} here.`}
        onSetPinned={onSetPinned}
      />
      {cut && limit < KNOWLEDGE_TAG_NOTES_MAX_LIMIT ? (
        <div className="px-2 py-1">
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setLimit((current) =>
                Math.min(
                  current + KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT,
                  KNOWLEDGE_TAG_NOTES_MAX_LIMIT,
                ),
              );
            }}
          >
            Show more
          </Button>
        </div>
      ) : null}
      <RenameTagDialog
        tag={renaming ? tag : null}
        onOpenChange={(open) => {
          if (!open) {
            setRenaming(false);
          }
        }}
        onRenamed={(from, to) => {
          onSelectTag(renamedTag(tag, from, to) ?? tag);
        }}
      />
    </>
  );
};
