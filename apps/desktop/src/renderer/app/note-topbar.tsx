import { docStem } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { toast } from "@repo/ui/components/sonner";
import { useSidebar } from "@repo/ui/components/sidebar";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FileDownIcon,
  LinkIcon,
  MessageSquareTextIcon,
  MoreVerticalIcon,
  PanelLeftIcon,
  PanelRightIcon,
  Share2Icon,
  TextSearchIcon,
} from "lucide-react";
import { Fragment } from "react";

import { shareWithAgentText } from "./actions/share-with-agent";
import { socketOrigin } from "./socket-origin";

export interface NoteTopbarProps {
  path: string | null;
  // passed in: this bar renders inside the right panel's provider, so `useSidebar()` here is the right one.
  railOpen: boolean;
  onToggleRail: () => void;
  // with the rail closed this bar is the window's top-left corner, where the traffic lights sit
  insetTitleBar: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onFindInNote: () => void;
  // a breadcrumb segment scopes the rail to that folder
  onOpenFolder: (folder: string) => void;
  commentCount: number;
  onOpenComments: () => void;
  onExportPdf: () => void;
}

function PanelToggle() {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label="Toggle panel"
      onClick={() => {
        toggleSidebar();
      }}
    >
      <PanelRightIcon />
    </Button>
  );
}

export function NoteTopbar({
  path,
  railOpen,
  onToggleRail,
  insetTitleBar,
  canBack,
  canForward,
  onBack,
  onForward,
  onFindInNote,
  onOpenFolder,
  commentCount,
  onOpenComments,
  onExportPdf,
}: NoteTopbarProps) {
  const segments =
    path === null
      ? []
      : dirnamePath(path)
          .split("/")
          .filter((segment) => segment !== "");
  // the server's origin, never the page's: an `inteligir://app` link opens nowhere, the shell included.
  const copyLink = () => {
    if (path === null) return;
    const url = new URL(socketOrigin());
    url.searchParams.set("note", path);
    navigator.clipboard.writeText(url.toString()).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy"),
    );
  };
  const copyForAgent = () => {
    if (path === null) return;
    navigator.clipboard.writeText(shareWithAgentText(path)).then(
      () => toast.success("Copied for an external agent"),
      () => toast.error("Could not copy"),
    );
  };

  return (
    <header
      className={cn(
        "flex h-[var(--app-header-h)] shrink-0 items-center gap-0.5 border-b border-line px-1.5 print:hidden",
        insetTitleBar && !railOpen && "pl-[4.5rem]",
      )}
    >
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={railOpen ? "Collapse the sidebar" : "Expand the sidebar"}
        aria-expanded={railOpen}
        onClick={onToggleRail}
      >
        <PanelLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label="Back"
        disabled={!canBack}
        onClick={onBack}
      >
        <ArrowLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label="Forward"
        disabled={!canForward}
        onClick={onForward}
      >
        <ArrowRightIcon />
      </Button>
      <nav
        aria-label="Note location"
        className="ml-2 flex min-w-0 items-center text-sm text-muted-foreground"
      >
        {segments.map((segment, index) => {
          const folder = segments.slice(0, index + 1).join("/");
          return (
            <Fragment key={folder}>
              <button
                type="button"
                className="min-w-0 shrink truncate rounded-sm px-0.5 hover:text-foreground"
                onClick={() => {
                  onOpenFolder(folder);
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
        <span className="min-w-0 truncate">{path === null ? "" : docStem(path)}</span>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label="Find in note"
          disabled={path === null}
          onClick={onFindInNote}
        >
          <TextSearchIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label="Copy link"
          disabled={path === null}
          onClick={copyLink}
        >
          <LinkIcon />
        </Button>
        <Tooltip content="Comments">
          <button
            type="button"
            aria-label={`Comments${commentCount > 0 ? ` (${String(commentCount)} open)` : ""}`}
            disabled={path === null}
            onClick={onOpenComments}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-muted-foreground outline-none hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4"
          >
            <MessageSquareTextIcon />
            {commentCount > 0 ? <span className="text-xs tabular-nums">{commentCount}</span> : null}
          </button>
        </Tooltip>
        <DropdownMenu>
          <Tooltip content="More">
            <DropdownMenuTrigger
              aria-label="More"
              disabled={path === null}
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4"
            >
              <MoreVerticalIcon />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExportPdf}>
              <FileDownIcon />
              Export as PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyForAgent}>
              <Share2Icon />
              Share with agent
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PanelToggle />
      </div>
    </header>
  );
}
