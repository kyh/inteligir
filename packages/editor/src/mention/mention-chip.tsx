import { useRef, useState } from "react";
import type { MouseEvent } from "react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@repo/ui/components/hover-card";
import { cn } from "@repo/ui/lib/cn";

import { useTitleOf } from "@repo/editor/host";
import { getEditorHostIo } from "@repo/editor/host-io";

import { shownTitle } from "@repo/contract/items/item-name";
import { cardPreview } from "@repo/contract/library/derive-item";

const HOVER_PREVIEW_DELAY_MS = 350;

const RESOLVED_CHIP_CLASS =
  "cursor-pointer rounded-sm bg-primary/10 px-1 text-primary transition-colors hover:bg-primary/20";
const UNRESOLVED_CHIP_CLASS =
  "cursor-pointer rounded-sm px-1 text-muted-foreground underline decoration-dashed decoration-muted-foreground/60 underline-offset-2 transition-colors hover:bg-muted";

// shows the item a chip names
const openItem = (itemId: string): void => {
  getEditorHostIo().openItem(itemId);
};

// a page link names its item by id, and shows the name the item goes by now; an item the
// library's titles do not list (gone, or not yet listed) draws the title the link was written
// with, and opens nothing
export const MentionChip = ({ itemId, title }: { itemId: string; title: string }) => {
  const live = useTitleOf(itemId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  // the item the open preview was read for; a read landing after a close is dropped
  const previewFor = useRef<string | null>(null);

  const label = shownTitle(live ?? title);
  const resolved = live === null ? null : itemId;

  const readPreview = async (target: string): Promise<void> => {
    try {
      const blocks = await getEditorHostIo().readItemBlocks(target);
      if (previewFor.current !== target) {
        return;
      }
      if (blocks === null) {
        setPreviewOpen(false);
        return;
      }
      setPreviewText(cardPreview(blocks));
    } catch {
      if (previewFor.current === target) {
        setPreviewOpen(false);
      }
    }
  };

  // read on every open, never cached across hovers, so an edit between them is never shown stale.
  const onPreviewOpenChange = (open: boolean): void => {
    setPreviewOpen(open);
    if (!open) {
      previewFor.current = null;
      setPreviewText(null);
      return;
    }
    if (resolved === null) {
      return;
    }
    previewFor.current = resolved;
    void readPreview(resolved);
  };

  const closePreview = (): void => {
    onPreviewOpenChange(false);
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    closePreview();
    if (resolved !== null) {
      openItem(resolved);
    }
  };

  // no `title` on a previewable chip: the OS tooltip would land on top of the hover card
  const chip = (
    <button
      type="button"
      contentEditable={false}
      onClick={onClick}
      className={cn(resolved === null ? UNRESOLVED_CHIP_CLASS : RESOLVED_CHIP_CLASS)}
    >
      {label}
    </button>
  );

  if (resolved === null) {
    return chip;
  }

  return (
    <HoverCard open={previewOpen} onOpenChange={onPreviewOpenChange}>
      <HoverCardTrigger delay={HOVER_PREVIEW_DELAY_MS} render={chip} />
      <HoverCardContent className="max-h-72 overflow-y-auto p-0">
        <button
          type="button"
          className="block w-full px-3 pt-2.5 pb-1 text-left text-body font-medium hover:underline"
          onClick={() => {
            closePreview();
            openItem(resolved);
          }}
        >
          {label}
        </button>
        <div className="px-3 pb-3 text-body whitespace-pre-wrap select-text">
          {previewText ?? <span className="text-muted-foreground">…</span>}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
