import { docStem } from "@repo/notes/knowledge/doc-file";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { toast } from "@repo/ui/components/sonner";
import { useSidebar } from "@repo/ui/components/sidebar";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FileDownIcon,
  LinkIcon,
  MessageSquareTextIcon,
  MoreVerticalIcon,
  PanelLeftIcon,
  PanelRightIcon,
  SearchIcon,
  Share2Icon,
} from "lucide-react";

import { shareWithAgentText } from "./actions/share-with-agent";
import { socketOrigin } from "./socket-origin";

export interface NoteTopbarProps {
  path: string | null;
  // passed in: this bar renders inside the right panel's provider, so `useSidebar()` here is the right one.
  railOpen: boolean;
  onToggleRail: () => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onOpenSearch: () => void;
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
  canBack,
  canForward,
  onBack,
  onForward,
  onOpenSearch,
  commentCount,
  onOpenComments,
  onExportPdf,
}: NoteTopbarProps) {
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
    <header className="flex h-[var(--app-header-h)] shrink-0 items-center gap-0.5 border-b border-line px-1.5 print:hidden">
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
      <span className="ml-2 min-w-0 truncate text-sm text-muted-foreground">
        {path === null ? "" : docStem(path)}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="icon-compact" aria-label="Search" onClick={onOpenSearch}>
          <SearchIcon />
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
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More"
            disabled={path === null}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4"
          >
            <MoreVerticalIcon />
          </DropdownMenuTrigger>
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
