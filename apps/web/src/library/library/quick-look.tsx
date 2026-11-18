import { KIND_LABELS } from "@repo/client/library-labels";
import { shownTitle } from "@repo/contract/items/item-name";
import { Badge } from "@repo/ui/components/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/ui/components/dialog";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import type { KeyboardEvent } from "react";

import { readingNotice } from "../item/item-stages";
import { useNow } from "../relative-time";
import { fileUrl } from "../cloud/library-files";
import { cardMeta, coverOf } from "./item-labels";
import { shortcutFor } from "../shortcuts";
import type { ListedItem } from "./listing";

export interface QuickLookProps {
  readonly row: ListedItem | null;
  readonly onClose: () => void;
  readonly onOpen: (row: ListedItem) => void;
  readonly onStep: (by: -1 | 1) => void;
}

const Look = ({ row }: { row: ListedItem }) => {
  const nowMs = useNow();
  const cover = coverOf(row);
  const notice = readingNotice(row.fields.reading);

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      {cover === null ? null : (
        <img alt="" src={fileUrl(cover)} className="max-h-72 w-full rounded-md object-contain" />
      )}
      <div className="flex items-center gap-2">
        <Badge>{KIND_LABELS[row.fields.kind]}</Badge>
        <DialogDescription>{cardMeta(row, nowMs)}</DialogDescription>
      </div>
      {notice === null ? null : <p className="m-0 text-body text-muted-foreground">{notice}</p>}
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (row === null) {
      return;
    }

    const shortcut = shortcutFor(event.nativeEvent, "grid", modifier);

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
