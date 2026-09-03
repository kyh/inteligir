// loaded via React.lazy from wiki-link-kit: this module reaches the editor host seam, so an
// eager import from a kit file base-kit composes would close an import cycle.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FilePlusIcon } from "lucide-react";

import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { cn } from "@repo/ui/lib/utils";

import { useVaultActions, useWikiResolver } from "@repo/editor/host";
import { getEditorHostIo } from "@repo/editor/host-io";
import { notePreviewHead } from "@repo/editor/note-preview";
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

type PreviewState = {
  rect: { left: number; bottom: number };
  text: string | null;
};

export default function WikiChip({ body }: { body: string }) {
  const { resolveWikiTarget } = useWikiResolver();
  const { openFile, createFile } = useVaultActions();
  const [createOpen, setCreateOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCache = useRef(new Map<string, string>());

  const parsed = parseWikiBody(body);
  const label = wikiChipLabel(body);
  // a pure-anchor link (`[[#sec]]`) points at the open note: nothing to resolve or create.
  const resolved = parsed.target === "" ? null : resolveWikiTarget(parsed.target);

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    },
    [],
  );

  const openPreview = (): void => {
    const rect = chipRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const anchor = { bottom: rect.bottom, left: rect.left };
    if (resolved === null) {
      setPreview({ rect: anchor, text: "Not created yet — click to create" });
      return;
    }
    const cached = previewCache.current.get(resolved);
    if (cached !== undefined) {
      setPreview({ rect: anchor, text: cached });
      return;
    }
    setPreview({ rect: anchor, text: null });
    getEditorHostIo()
      .readVaultFile({ path: resolved })
      .then((content) => {
        const head = notePreviewHead(content);
        previewCache.current.set(resolved, head);
        setPreview((current) => (current === null ? null : { ...current, text: head }));
        return undefined;
      })
      .catch(() => {
        setPreview(null);
      });
  };

  const closePreview = (): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setPreview(null);
    // the cache lives for one hover, so an agent edit between hovers is never shown stale.
    previewCache.current.clear();
  };

  const onMouseEnter = (): void => {
    if (parsed.target === "" || createOpen) return;
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(openPreview, HOVER_PREVIEW_DELAY_MS);
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

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        contentEditable={false}
        title={
          parsed.target === ""
            ? label
            : (resolved ?? `${parsed.target} — not created yet (click to create)`)
        }
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={closePreview}
        className={cn(resolved !== null ? RESOLVED_CHIP_CLASS : UNRESOLVED_CHIP_CLASS)}
      >
        {label}
      </button>
      {preview !== null && (
        <div
          className="pointer-events-none fixed z-50 max-h-72 w-80 overflow-hidden rounded-lg border border-border bg-popover p-3 text-xs whitespace-pre-wrap text-popover-foreground shadow-md"
          style={{ left: preview.rect.left, top: preview.rect.bottom + 6 }}
        >
          {preview.text === null ? (
            <span className="text-muted-foreground">…</span>
          ) : preview.text === "" ? (
            <span className="text-muted-foreground">Empty note</span>
          ) : (
            preview.text
          )}
        </div>
      )}
      {resolved === null && parsed.target !== "" && (
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
