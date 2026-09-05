// loaded via React.lazy from wiki-link-kit: this module reaches the editor host seam, so an
// eager import from a kit file base-kit composes would close an import cycle.

import { useRef, useState, type MouseEvent } from "react";
import { FilePlusIcon } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@repo/ui/components/hover-card";
import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { cn } from "@repo/ui/lib/utils";

import { useVaultActions, useWikiResolver } from "@repo/editor/host";
import { getEditorHostIo } from "@repo/editor/host-io";
import { notePreviewHead } from "@repo/editor/note-preview";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { isUuidWikiAlias, parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

const HOVER_PREVIEW_DELAY_MS = 350;

// the resolved-link uuid alias is identity plumbing, not display text.
export function wikiChipLabel(body: string): string {
  const parsed = parseWikiBody(body);
  if (parsed.alias && !isUuidWikiAlias(parsed.alias)) return parsed.alias;
  return parsed.anchor ? `${parsed.target}#${parsed.anchor}` : parsed.target;
}

export const RESOLVED_CHIP_CLASS =
  "cursor-pointer rounded-sm bg-primary/10 px-1 text-primary transition-colors hover:bg-primary/20";
export const UNRESOLVED_CHIP_CLASS =
  "cursor-pointer rounded-sm px-1 text-muted-foreground underline decoration-dashed decoration-muted-foreground/60 underline-offset-2 transition-colors hover:bg-muted";

function PreviewBody({ text }: { text: string | null }) {
  if (text === null) return <span className="text-muted-foreground">…</span>;
  if (text === "") return <span className="text-muted-foreground">Empty note</span>;
  return <>{text}</>;
}

export default function WikiChip({ body }: { body: string }) {
  const { resolveWikiTarget } = useWikiResolver();
  const { openFile, createFile } = useVaultActions();
  const [createOpen, setCreateOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  // the path the open preview was read for; a read landing after a close or a re-resolve is dropped
  const previewFor = useRef<string | null>(null);

  const parsed = parseWikiBody(body);
  const label = wikiChipLabel(body);
  // a pure-anchor link (`[[#sec]]`) points at the open note: nothing to resolve or create.
  const resolved = parsed.target === "" ? null : resolveWikiTarget(parsed.target);

  // read on every open, never cached across hovers, so an agent edit between them is never shown stale.
  const onPreviewOpenChange = (open: boolean): void => {
    setPreviewOpen(open);
    if (!open) {
      previewFor.current = null;
      setPreviewText(null);
      return;
    }
    if (resolved === null) return;
    previewFor.current = resolved;
    getEditorHostIo()
      .readVaultFile({ path: resolved })
      .then((content) => {
        if (previewFor.current === resolved) setPreviewText(notePreviewHead(content));
        return undefined;
      })
      .catch(() => {
        if (previewFor.current === resolved) setPreviewOpen(false);
      });
  };

  const closePreview = (): void => {
    onPreviewOpenChange(false);
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    closePreview();
    if (parsed.target === "") return;
    if (resolved !== null) {
      openFile(resolved);
      return;
    }
    setCreateOpen(true);
  };

  // no `title` on a previewable chip: the OS tooltip would land on top of the hover card
  const chip = (
    <button
      ref={chipRef}
      type="button"
      contentEditable={false}
      onClick={onClick}
      className={cn(resolved !== null ? RESOLVED_CHIP_CLASS : UNRESOLVED_CHIP_CLASS)}
    >
      {label}
    </button>
  );

  if (parsed.target === "") return chip;

  return (
    <>
      <HoverCard open={previewOpen && !createOpen} onOpenChange={onPreviewOpenChange}>
        <HoverCardTrigger delay={HOVER_PREVIEW_DELAY_MS} render={chip} />
        <HoverCardContent className="max-h-72 overflow-y-auto p-0">
          {resolved === null ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              Not created yet — click to create
            </p>
          ) : (
            <>
              <button
                type="button"
                className="block w-full px-3 pt-2.5 pb-1 text-left text-xs font-medium hover:underline"
                onClick={() => {
                  closePreview();
                  openFile(resolved);
                }}
              >
                {docStem(resolved)}
              </button>
              <div className="px-3 pb-3 text-xs whitespace-pre-wrap select-text">
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
                void createFile(parsed.target);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <FilePlusIcon className="size-4 text-muted-foreground" />
              <span>
                Create <span className="font-medium">{parsed.target}.md</span>
              </span>
            </button>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
