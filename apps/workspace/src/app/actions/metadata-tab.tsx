import { useLiveEditor } from "@repo/editor/live-editor";
import { PropertiesPanel } from "@repo/editor/properties/properties-panel";
import { Button } from "@repo/ui/components/button";
import { ArchiveRestoreIcon, PinIcon, PinOffIcon, Trash2Icon } from "lucide-react";

import { FoldSection } from "../fold-section";
import { NoteFacts } from "./note-facts";
import { RelatedInline } from "./related-section";
import { usePinnedPaths } from "../vault-hooks";

// the note's own buttons: pinning it, deleting it, and the list a deleted note comes back from
export interface NoteMetadataActions {
  setPinned: (pinned: boolean) => void;
  deleteNote: () => void;
  openDeletedNotes: () => void;
}

export const InlineProperties = ({
  docPath,
  open,
  onOpenChange,
}: {
  docPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const editor = useLiveEditor(open ? docPath : null);
  return (
    <FoldSection label="Properties" open={open} onOpenChange={onOpenChange}>
      <div className="px-3 pb-2">
        {editor === null ? (
          <p className="pb-1 text-body text-muted-foreground">Open the note to edit properties.</p>
        ) : (
          <PropertiesPanel editor={editor} />
        )}
      </div>
    </FoldSection>
  );
};

export const NoteMetadataTab = ({
  docPath,
  propertiesOpen,
  onPropertiesOpenChange,
  onOpenDoc,
  actions,
}: {
  docPath: string | null;
  propertiesOpen: boolean;
  onPropertiesOpenChange: (open: boolean) => void;
  onOpenDoc: (path: string) => void;
  actions: NoteMetadataActions;
}) => {
  const pinnedPaths = usePinnedPaths();
  const pinned = docPath !== null && pinnedPaths.has(docPath);
  const { deleteNote, openDeletedNotes } = actions;
  if (docPath === null) {
    return (
      <p className="p-3 text-subtitle text-muted-foreground">Open a note to see its metadata.</p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <InlineProperties
        docPath={docPath}
        open={propertiesOpen}
        onOpenChange={onPropertiesOpenChange}
      />
      <RelatedInline docPath={docPath} onOpenDoc={onOpenDoc} />
      <NoteFacts docPath={docPath} />
      <div className="px-3 py-2">
        <p className="pb-1 text-caption font-medium text-muted-foreground uppercase">Note</p>
        <div className="-ml-2 flex flex-col items-start">
          <Button
            variant="ghost"
            size="compact"
            leadingIcon={pinned ? PinOffIcon : PinIcon}
            onClick={() => {
              actions.setPinned(!pinned);
            }}
          >
            {pinned ? "Unpin note" : "Pin note"}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            leadingIcon={Trash2Icon}
            className="text-destructive hover:text-destructive"
            onClick={deleteNote}
          >
            Delete note
          </Button>
          <Button
            variant="ghost"
            size="compact"
            leadingIcon={ArchiveRestoreIcon}
            onClick={openDeletedNotes}
          >
            Deleted notes…
          </Button>
        </div>
      </div>
    </div>
  );
};
