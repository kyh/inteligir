// The live wiki-link chip: resolves its target against the vault listing and
// navigates on click. Unresolved targets are visually distinct (dashed) and
// clicking offers to create the note. Hovering shows the target's head as a
// plain-text preview (pointer-inert, so it never intercepts the hover).
//
// Loaded via React.lazy from wiki-link-kit: this module reaches into
// vault-context (and through it the markdown pipeline and base-kit), so an
// eager import from the kit file — which base-kit composes — would close an
// import cycle around the kit files.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FilePlusIcon } from "lucide-react";

import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { cn } from "@repo/ui/lib/utils";

import { useVaultActions, useVaultListing } from "@repo/editor/host";
import { getEditorHostIo } from "@repo/editor/host-io";
import { useSplitViewActions } from "@repo/editor/split-request";
import { notePreviewHead } from "@repo/editor/note-preview";
import { isUuidWikiAlias, parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

const HOVER_PREVIEW_DELAY_MS = 350;

/** Shared chip label: alias wins — unless it is the resolved-link uuid,
 * which is identity plumbing, not display text — else target(+anchor). */
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
  /** null while the read is in flight. */
  text: string | null;
};

export default function WikiChip({ body }: { body: string }) {
  const { resolveWikiTarget } = useVaultListing();
  const { openFile, createFile } = useVaultActions();
  const [createOpen, setCreateOpen] = useState(false);
  // Right-click menu (one item): position, or null while closed.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const split = useSplitViewActions((state) => state.actions);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCache = useRef(new Map<string, string>());

  const parsed = parseWikiBody(body);
  const label = wikiChipLabel(body);
  // A pure-anchor link (`[[#sec]]`) points at the open note — nothing to
  // resolve or create; render an inert chip.
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
    // The cache lives for the hover: a re-hover re-reads, so an agent edit
    // between hovers is never shown stale.
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

  // The split affordance: right-click a resolved chip → open in the split
  // pane. Offered only while the shell registered the action AND the target
  // resolves — an unresolved chip's menu would only duplicate click-to-create.
  const onContextMenu = (e: MouseEvent) => {
    if (split === null || resolved === null) return;
    e.preventDefault();
    closePreview();
    setMenuAt({ x: e.clientX, y: e.clientY });
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
        onContextMenu={onContextMenu}
        onMouseEnter={onMouseEnter}
        onMouseLeave={closePreview}
        className={cn(resolved !== null ? RESOLVED_CHIP_CLASS : UNRESOLVED_CHIP_CLASS)}
      >
        {label}
      </button>
      {menuAt !== null && resolved !== null && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => {
              setMenuAt(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuAt(null);
            }}
          />
          <div
            className="fixed z-50 min-w-40 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
            style={{ left: menuAt.x, top: menuAt.y }}
          >
            <button
              type="button"
              className="w-full rounded-md px-2 py-1 text-left hover:bg-muted"
              onClick={() => {
                setMenuAt(null);
                split?.openInSplit(resolved);
              }}
            >
              Open in split
            </button>
          </div>
        </>
      )}
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
