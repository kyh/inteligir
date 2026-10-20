// A look at a card without leaving the grid: the item's own stage in a dialog, a note or a saved
// page drawn read-only over its bytes. The arrows step through the grid's order, Space or Escape
// closes, Enter opens the item, and the focus goes back to the card it was opened from.

import { StaticNote } from "@repo/editor/static-note";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import type { KeyboardEvent } from "react";

import { orpc } from "../api";
import {
  FileStage,
  ImageStage,
  MediaStage,
  PdfStage,
  PendingStage,
  SourceHeader,
} from "../item/item-stages";
import { useMediaOrigin } from "../vault-hooks";
import { isUrlItem } from "./item-labels";
import { libraryShortcutFor } from "./library-keys";
import { useItemRow } from "./library-items";
import { parseItemTime } from "@repo/notes/items/item-time";
import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import type { MediaOrigin } from "../vault-hooks";

export interface QuickLookProps {
  path: string | null;
  onClose: () => void;
  onOpen: (path: string) => void;
  // -1 or +1 along the grid's order
  onStep: (path: string, by: -1 | 1) => void;
}

const TextLook = ({ row }: { row: ItemRowWire }) => {
  const read = useQuery(orpc.vault.read.queryOptions({ input: { path: row.path } }));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {isUrlItem(row) && row.url !== null ? (
        <SourceHeader
          url={row.url}
          site={row.site}
          host={row.host}
          savedMs={row.saved === null ? null : parseItemTime(row.saved)}
        />
      ) : null}
      <div className="px-8 py-6 text-subtitle">
        {read.data === undefined ? (
          <p className="m-0 text-muted-foreground">
            {read.isError ? "This item could not be read." : "Loading…"}
          </p>
        ) : (
          <StaticNote content={read.data.content} path={row.path} />
        )}
      </div>
    </div>
  );
};

const LookStage = ({ row, media }: { row: ItemRowWire; media: MediaOrigin | null }) => {
  if (row.pending) {
    return <PendingStage onReadHere={null} />;
  }
  const { file } = row;
  if (file === null || media === null || row.kind === "note" || row.kind === "link") {
    return <TextLook row={row} />;
  }
  switch (row.kind) {
    case "image": {
      return <ImageStage file={file} media={media} />;
    }
    case "pdf": {
      return <PdfStage file={file} media={media} />;
    }
    case "video":
    case "audio": {
      return <MediaStage file={file} kind={row.kind} media={media} />;
    }
    case "file": {
      return <FileStage file={file} bytes={row.fileBytes} />;
    }
    default: {
      const exhaustive: never = row.kind;
      return exhaustive;
    }
  }
};

export const QuickLook = ({ path, onClose, onOpen, onStep }: QuickLookProps) => {
  const rowQuery = useItemRow(path);
  const row = rowQuery.data ?? null;
  const media = useMediaOrigin();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (path === null || event.defaultPrevented) {
      return;
    }
    const shortcut = libraryShortcutFor(event, "grid", platformShortcutModifier());
    switch (shortcut?.action) {
      case "move-left": {
        onStep(path, -1);
        break;
      }
      case "move-right": {
        onStep(path, 1);
        break;
      }
      case "quick-look":
      case "clear-selection": {
        onClose();
        break;
      }
      case "open-item": {
        onOpen(path);
        break;
      }
      default: {
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Dialog
      open={path !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="flex h-[80vh] max-w-[min(100%-2rem,900px)] flex-col gap-0 overflow-hidden p-0"
        onKeyDown={onKeyDown}
      >
        <div className="flex h-11 shrink-0 items-center border-b border-line px-4 pr-12">
          {/* the dialog's name: the item's title, once its row has loaded */}
          <DialogTitle className="truncate text-subtitle">{row?.title ?? "Quick Look"}</DialogTitle>
        </div>
        {row === null ? <div className="flex-1" /> : <LookStage row={row} media={media} />}
      </DialogContent>
    </Dialog>
  );
};
