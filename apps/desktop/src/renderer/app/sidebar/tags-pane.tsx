// The Tags view and everything only it holds: the selected tag, the rename dialog and the
// tag's paged listing. Mounted on its tab alone, so its queries are armed only while it shows.

import { Button } from "@repo/ui/components/button";
import { renamedTag } from "@repo/notes/knowledge/rename-tags";
import {
  KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT,
  KNOWLEDGE_TAG_NOTES_MAX_LIMIT,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { useMemo, useState } from "react";
import { useNotesWithTag, useTags } from "../vault-hooks";
import { NotesList } from "./notes-list";
import { RenameTagDialog, TagScopeHeader, TagsView } from "./tags-view";

export interface TagsPaneProps {
  // the listing's entries, already scoped to the folder
  entries: readonly VaultEntry[];
  scope: string;
  openPath: string | null;
  onOpenFile: (path: string) => void;
  onSetPinned: (path: string, pinned: boolean) => void;
  // owned by the workspace: a `#tag` chip anywhere in the note sets it
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
}

// One page that grows: the list is re-read whole rather than stitched, since the drawn list is
// scope-filtered and recency-sorted afterwards. Keyed on the tag by the pane, so a new tag
// starts at the first page without a reset in userland.
function TaggedNotes({
  tag,
  entries,
  scope,
  openPath,
  onOpenFile,
  onSetPinned,
  onClear,
  onRename,
}: {
  tag: string;
  entries: readonly VaultEntry[];
  scope: string;
  openPath: string | null;
  onOpenFile: (path: string) => void;
  onSetPinned: (path: string, pinned: boolean) => void;
  onClear: () => void;
  onRename: () => void;
}) {
  const [limit, setLimit] = useState(KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT);
  const taggedQuery = useNotesWithTag(tag, limit);
  const taggedPaths = useMemo(() => new Set(taggedQuery.data?.paths ?? []), [taggedQuery.data]);
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
        onClear={onClear}
        onRename={onRename}
      />
      <NotesList
        entries={taggedEntries}
        scope={scope}
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
    </>
  );
}

export function TagsPane({
  entries,
  scope,
  openPath,
  onOpenFile,
  onSetPinned,
  selectedTag,
  onSelectTag,
}: TagsPaneProps) {
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const tagsQuery = useTags(selectedTag === null);
  return (
    <>
      {selectedTag === null ? (
        <TagsView
          tags={tagsQuery.data?.tags ?? []}
          loaded={tagsQuery.data !== undefined}
          onSelect={onSelectTag}
          onRename={setRenamingTag}
        />
      ) : (
        <TaggedNotes
          key={selectedTag}
          tag={selectedTag}
          entries={entries}
          scope={scope}
          openPath={openPath}
          onOpenFile={onOpenFile}
          onSetPinned={onSetPinned}
          onClear={() => {
            onSelectTag(null);
          }}
          onRename={() => {
            setRenamingTag(selectedTag);
          }}
        />
      )}
      <RenameTagDialog
        tag={renamingTag}
        onOpenChange={(open) => {
          if (!open) setRenamingTag(null);
        }}
        onRenamed={(from, to) => {
          if (selectedTag !== null) onSelectTag(renamedTag(selectedTag, from, to) ?? selectedTag);
        }}
      />
    </>
  );
}
