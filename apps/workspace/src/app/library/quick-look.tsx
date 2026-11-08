// A look at a card without leaving the grid: its cover, where it came from, its first paragraph
// and its outline, as the cell lists them. The arrows step through the grid's order, Space or
// Escape closes, Enter opens the item, and the focus goes back to the card it was opened from.

import { shownTitle } from "@repo/notes/items/item-name";
import { Badge } from "@repo/ui/components/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/ui/components/dialog";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import type { KeyboardEvent } from "react";

import { useNow } from "../relative-time";
import { fileUrl } from "../cloud/library-files";
import { cardMeta, coverOf, KIND_LABELS } from "./item-labels";
import { libraryShortcutFor } from "./library-keys";
import type { ListedItem } from "./listing";

export interface QuickLookProps {
  readonly row: ListedItem | null;
  readonly onClose: () => void;
  readonly onOpen: (row: ListedItem) => void;
  // -1 or +1 along the grid's order
  readonly onStep: (by: -1 | 1) => void;
}

const Look = ({ row }: { row: ListedItem }) => {
  const nowMs = useNow();
  const cover = coverOf(row);
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      {cover === null ? null : (
        <img alt="" src={fileUrl(cover)} className="max-h-72 w-full rounded-md object-contain" />
      )}
      <div className="flex items-center gap-2">
        <Badge variant="outline">{KIND_LABELS[row.fields.kind]}</Badge>
        <DialogDescription>{cardMeta(row, nowMs)}</DialogDescription>
      </div>
      {row.fields.fetchState === "pending" ? (
        <p className="m-0 text-body text-muted-foreground">
          Not read yet: the page is read in the cloud, and its text lands here soon.
        </p>
      ) : null}
      {row.card.preview === "" ? null : (
        <p className="m-0 text-subtitle break-words text-ink-2 select-text">{row.card.preview}</p>
      )}
      {row.card.outline.length === 0 ? null : (
        <ul className="m-0 list-none p-0 text-body text-muted-foreground">
          {row.card.outline.map((entry) => (
            <li key={entry.blockId} style={{ paddingLeft: `${String((entry.level - 1) * 12)}px` }}>
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const QuickLook = ({ row, onClose, onOpen, onStep }: QuickLookProps) => {
  const modifier = platformShortcutModifier();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (row === null) {
      return;
    }
    const shortcut = libraryShortcutFor(event, "grid", modifier);
    switch (shortcut?.action) {
      case "quick-look": {
        event.preventDefault();
        onClose();
        return;
      }
      case "open-item": {
        event.preventDefault();
        onOpen(row);
        return;
      }
      case "move-left":
      case "move-up": {
        event.preventDefault();
        onStep(-1);
        return;
      }
      case "move-right":
      case "move-down": {
        event.preventDefault();
        onStep(1);
        break;
      }
      default: {
        break;
      }
    }
  };
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-xl" onKeyDown={onKeyDown}>
        <DialogTitle>{row === null ? "" : shownTitle(row.card.title)}</DialogTitle>
        {row === null ? null : <Look row={row} />}
      </DialogContent>
    </Dialog>
  );
};
