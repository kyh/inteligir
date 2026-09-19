import { setFindBarAnchor } from "@repo/editor/find-bar";
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
import { cn } from "@repo/ui/lib/cn";
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

const copyText = async (text: string, done: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast.error("Could not copy");
    return;
  }
  toast.success(done);
};

const PanelToggle = () => {
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
};

export const NoteTopbar = ({
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
}: NoteTopbarProps) => {
  const segments =
    path === null
      ? []
      : dirnamePath(path)
          .split("/")
          .filter((segment) => segment !== "");
  // the server's origin, never the page's: an `inteligir://app` link opens nowhere, the shell included.
  const copyLink = () => {
    if (path === null) {
      return;
    }
    const url = new URL(socketOrigin());
    url.searchParams.set("note", path);
    void copyText(url.toString(), "Link copied");
  };
  const copyForAgent = () => {
    if (path === null) {
      return;
    }
    void copyText(shareWithAgentText(path), "Copied for an external agent");
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
        className="ml-2 flex min-w-0 items-center text-body text-muted-foreground"
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
          ref={setFindBarAnchor}
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
          aria-label={`Comments${commentCount > 0 ? ` (${String(commentCount)} open)` : ""}`}
          disabled={path === null}
          onClick={onOpenComments}
          className={cn(commentCount > 0 && "w-auto gap-1 px-1.5")}
        >
          <MessageSquareTextIcon />
          {commentCount > 0 ? <span className="text-body tabular-nums">{commentCount}</span> : null}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={path === null}
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
};
