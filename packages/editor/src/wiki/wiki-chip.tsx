// loaded via React.lazy from wiki-link-kit: this module reaches the editor host seam, so an
// eager import from a kit file base-kit composes would close an import cycle.

import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import { FilePlusIcon } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@repo/ui/components/hover-card";
import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { cn } from "@repo/ui/lib/cn";

import { useLinkResolver } from "@repo/editor/host";
import { getEditorHostIo } from "@repo/editor/host-io";
import { notePreviewHead } from "@repo/editor/note-preview";

import { createLinkedNote } from "@repo/editor/wiki/wiki-insert";
import { wikiLabelOf } from "@repo/editor/wiki/wiki-node";
import type { WikiNodeFields } from "@repo/editor/wiki/wiki-node";

const HOVER_PREVIEW_DELAY_MS = 350;

const RESOLVED_CHIP_CLASS =
  "cursor-pointer rounded-sm bg-primary/10 px-1 text-primary transition-colors hover:bg-primary/20";
const UNRESOLVED_CHIP_CLASS =
  "cursor-pointer rounded-sm px-1 text-muted-foreground underline decoration-dashed decoration-muted-foreground/60 underline-offset-2 transition-colors hover:bg-muted";

const PreviewBody = ({ text }: { text: string | null }) => {
  if (text === null) {
    return <span className="text-muted-foreground">…</span>;
  }
  if (text === "") {
    return <span className="text-muted-foreground">Empty note</span>;
  }
  return text;
};

// shows the item a chip names
const openItem = (itemId: string): void => {
  getEditorHostIo().openItem(itemId);
};

// a link by id reaches its item whatever title it was written with, and an anchor alone
// (`[[#sec]]`) reaches none; with no title there is nothing to create
const WikiChip = ({ link }: { link: WikiNodeFields }) => {
  const { resolveWikiTarget, titleOf } = useLinkResolver();
  const [createOpen, setCreateOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  // the item the open preview was read for; a read landing after a close or a re-resolve is dropped
  const previewFor = useRef<string | null>(null);

  // a link to an item by its id shows the name the item goes by now
  const live = link.itemId === null ? null : titleOf(link.itemId);
  const label = wikiLabelOf(live === null ? link : { ...link, title: live });
  const resolved = resolveWikiTarget(link.title, link.itemId ?? link.alias);
  const nameOf = (itemId: string): string => {
    const name = titleOf(itemId);
    return name === null || name === "" ? label : name;
  };

  const readPreview = async (itemId: string): Promise<void> => {
    try {
      const blocks = await getEditorHostIo().readItemBlocks(itemId);
      if (previewFor.current !== itemId) {
        return;
      }
      if (blocks === null) {
        setPreviewOpen(false);
        return;
      }
      setPreviewText(notePreviewHead(blocks.map((block) => ({ ...block }))));
    } catch {
      if (previewFor.current === itemId) {
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
    } else if (link.title !== "") {
      setCreateOpen(true);
    }
  };

  // no `title` on a previewable chip: the OS tooltip would land on top of the hover card
  const chip = (
    <button
      ref={chipRef}
      type="button"
      contentEditable={false}
      onClick={onClick}
      className={cn(resolved === null ? UNRESOLVED_CHIP_CLASS : RESOLVED_CHIP_CLASS)}
    >
      {label}
    </button>
  );

  if (resolved === null && link.title === "") {
    return chip;
  }

  return (
    <>
      <HoverCard open={previewOpen && !createOpen} onOpenChange={onPreviewOpenChange}>
        <HoverCardTrigger delay={HOVER_PREVIEW_DELAY_MS} render={chip} />
        <HoverCardContent className="max-h-72 overflow-y-auto p-0">
          {resolved === null ? (
            <p className="px-3 py-2.5 text-body text-muted-foreground">
              Not created yet — click to create
            </p>
          ) : (
            <>
              <button
                type="button"
                className="block w-full px-3 pt-2.5 pb-1 text-left text-body font-medium hover:underline"
                onClick={() => {
                  closePreview();
                  openItem(resolved);
                }}
              >
                {nameOf(resolved)}
              </button>
              <div className="px-3 pb-3 text-body whitespace-pre-wrap select-text">
                <PreviewBody text={previewText} />
              </div>
            </>
          )}
        </HoverCardContent>
      </HoverCard>
      {resolved === null && (
        <Popover open={createOpen} onOpenChange={setCreateOpen}>
          <PopoverContent anchor={chipRef} className="p-1">
            <button
              type="button"
              onClick={() => {
                setCreateOpen(false);
                void createLinkedNote(link.title);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-accent hover:text-accent-foreground"
            >
              <FilePlusIcon className="size-4 text-muted-foreground" />
              <span>
                Create <span className="font-medium">{link.title}</span>
              </span>
            </button>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
};

export default WikiChip;
