// An item's top bar. The breadcrumb NARROWS: "Library" goes back to the library, each folder
// segment to that folder's scope, Unsorted to Unsorted. Copy link copies the item's
// `[[wiki link]]` for every kind, because pasted into a note it links the item and a loopback url
// opens nothing elsewhere; a url item adds Copy address, which copies where it came from.

import { setFindBarAnchor } from "@repo/editor/find-bar";
import { getEditorHostIo } from "@repo/editor/host-io";
import type { LibraryScope } from "@repo/domain/library-scope";
import { UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { wikiLinkFor } from "@repo/notes/knowledge/link-resolve";
import { basenamePath, dirnamePath } from "@repo/notes/knowledge/vault-path";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { toast } from "@repo/ui/components/sonner";
import { ToggleChip, ToggleGroup } from "@repo/ui/components/toggle-group";
import { cn } from "@repo/ui/lib/cn";
import {
  AtSignIcon,
  FileDownIcon,
  HighlighterIcon,
  LinkIcon,
  MoreVerticalIcon,
  PencilLineIcon,
  TextSearchIcon,
} from "lucide-react";
import { Fragment } from "react";

import { copyText } from "../copy-text";
import { PanelToggle, TopbarLead, TopbarShell } from "../topbar-lead";
import type { TopbarLeadProps } from "../topbar-lead";

export type ItemFace = "article" | "page-copy";

export interface ItemTopbarProps {
  path: string;
  lead: TopbarLeadProps;
  insetTitleBar: boolean;
  onGoToLibrary: (scope?: LibraryScope) => void;
  // false for a viewer: Find, Export and Annotations need the editor
  editable: boolean;
  url: string | null;
  // a saved page that kept a copy shows the "Article | Page copy" switch
  face: ItemFace | null;
  onFaceChange: (face: ItemFace) => void;
  // a viewer offers "Edit as note"; a pending stub offers nothing that edits it
  onEditAsNote: (() => void) | null;
  onFindInNote: () => void;
  annotationCount: number;
  onOpenAnnotations: () => void;
  onExportPdf: () => void;
}

// the scope a breadcrumb segment narrows to: Unsorted is a scope of its own
const segmentScope = (folder: string): LibraryScope =>
  folder === UNSORTED_FOLDER ? { kind: "unsorted" } : { kind: "folder", path: folder };

const itemName = (path: string): string => docStem(path) || basenamePath(path);

export const ItemTopbar = ({
  path,
  lead,
  insetTitleBar,
  onGoToLibrary,
  editable,
  url,
  face,
  onFaceChange,
  onEditAsNote,
  onFindInNote,
  annotationCount,
  onOpenAnnotations,
  onExportPdf,
}: ItemTopbarProps) => {
  const segments = dirnamePath(path)
    .split("/")
    .filter((segment) => segment !== "");
  // read at the click, not through useLinkResolver: the bar renders before the vault installs the
  // editor's host, and a subscription would re-render it on every listing refresh.
  const copyLink = () => {
    const link = wikiLinkFor(path, getEditorHostIo().linkResolver.getState().resolveWikiTarget);
    if (link === null) {
      toast.error("No link can name this item, so nothing was copied.");
      return;
    }
    void copyText(link, "Link copied");
  };

  return (
    <TopbarShell insetTitleBar={insetTitleBar} railOpen={lead.railOpen}>
      <TopbarLead {...lead} />
      <nav
        aria-label="Item location"
        className="ml-2 flex min-w-0 items-center text-body text-muted-foreground"
      >
        <button
          type="button"
          aria-label="Back to library"
          className="shrink-0 rounded-sm px-0.5 hover:text-foreground"
          onClick={() => {
            onGoToLibrary();
          }}
        >
          Library
        </button>
        <span aria-hidden="true" className="shrink-0 px-0.5 text-muted-foreground/60">
          ›
        </span>
        {segments.map((segment, index) => {
          const folder = segments.slice(0, index + 1).join("/");
          return (
            <Fragment key={folder}>
              <button
                type="button"
                className="min-w-0 shrink truncate rounded-sm px-0.5 hover:text-foreground"
                onClick={() => {
                  onGoToLibrary(segmentScope(folder));
                }}
              >
                {segment}
              </button>
              <span aria-hidden="true" className="shrink-0 px-0.5 text-muted-foreground/60">
                ›
              </span>
            </Fragment>
          );
        })}
        <span className="min-w-0 truncate text-ink">{itemName(path)}</span>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {face === null ? null : (
          <ToggleGroup<ItemFace>
            aria-label="Show"
            className="mr-1"
            value={[face]}
            onValueChange={([picked]) => {
              if (picked !== undefined) {
                onFaceChange(picked);
              }
            }}
          >
            <ToggleChip value="article">Article</ToggleChip>
            <ToggleChip value="page-copy">Page copy</ToggleChip>
          </ToggleGroup>
        )}
        <Button
          ref={setFindBarAnchor}
          variant="ghost"
          size="icon-compact"
          aria-label="Find in note"
          disabled={!editable}
          onClick={onFindInNote}
        >
          <TextSearchIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={`Annotations${annotationCount > 0 ? ` (${String(annotationCount)})` : ""}`}
          disabled={!editable}
          onClick={onOpenAnnotations}
          className={cn(annotationCount > 0 && "w-auto gap-1 px-1.5")}
        >
          <HighlighterIcon />
          {annotationCount > 0 ? (
            <span className="text-body tabular-nums">{annotationCount}</span>
          ) : null}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-compact" aria-label="More">
                <MoreVerticalIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={copyLink}>
              <LinkIcon />
              Copy link
            </DropdownMenuItem>
            {url === null ? null : (
              <DropdownMenuItem
                onClick={() => {
                  void copyText(url, "Address copied");
                }}
              >
                <AtSignIcon />
                Copy address
              </DropdownMenuItem>
            )}
            {onEditAsNote === null ? null : (
              <DropdownMenuItem onClick={onEditAsNote}>
                <PencilLineIcon />
                Edit as note
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!editable} onClick={onExportPdf}>
              <FileDownIcon />
              Export as PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PanelToggle />
      </div>
    </TopbarShell>
  );
};
