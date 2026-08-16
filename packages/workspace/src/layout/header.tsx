import { Fragment, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PilcrowIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@repo/ui/components/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/ui/components/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { SidebarTrigger, useSidebar } from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";

import { confirmVaultDelete } from "@repo/workspace/components/confirm-vault-delete";
import { PageDetails } from "@repo/editor/properties/page-details";
import { richAvailable } from "@repo/editor/note/open-doc";
import { setOpenNoteMode, useOpenNote } from "@repo/editor/note/open-note-store";
import { useNavHistory } from "@repo/workspace/workspace/use-nav-history";
import { SURFACE_LABEL, useViewStore } from "@repo/workspace/stores/view-store";
import { useVaultActions, useVaultListing } from "@repo/editor/host";

/**
 * The shell header, and the only chrome over the document: the sidebar toggle,
 * Back/Forward, a breadcrumb of where you are, and ONE overflow menu holding
 * every per-file action. Nothing about the note's STATE lives here — private,
 * Raw and save status are the status bar's, which is where a reader looks for
 * status rather than for something to press. Also the window drag region; when
 * the sidebar is collapsed the pane slides under the macOS traffic lights, so
 * the left padding keeps the toggle clear of them.
 */
export function Header() {
  const { folderName } = useVaultListing();
  const surface = useViewStore((s) => s.surface);
  const { back, forward, goBack, goForward } = useNavHistory();
  // Narrow selectors: every value here is a primitive, so typing in the note
  // never re-renders the header — only surface/path flips do.
  const path = useOpenNote((s) => s.editor.path);
  const { state } = useSidebar();
  const segments = surface === "editor" && path !== null ? path.split("/") : [];

  return (
    <header
      className={cn(
        "app-drag sticky top-0 z-20 flex h-11 shrink-0 items-center gap-0.5 bg-background px-3",
        state === "collapsed" && "pl-20",
      )}
    >
      <SidebarTrigger className="app-no-drag -ml-1 text-muted-foreground" />
      <NavButton
        label="Back"
        hint="Back (⌥←)"
        disabled={back === null}
        onClick={goBack}
        icon={<ChevronLeftIcon className="size-4" />}
      />
      <NavButton
        label="Forward"
        hint="Forward (⌥→)"
        disabled={forward === null}
        onClick={goForward}
        icon={<ChevronRightIcon className="size-4" />}
      />

      <Breadcrumb className="ml-1.5 min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            <span className="text-muted-foreground">{folderName || "Vault"}</span>
          </BreadcrumbItem>
          {surface !== "editor" && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{SURFACE_LABEL[surface]}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
          {segments.map((seg, i) => (
            <Fragment key={segments.slice(0, i + 1).join("/")}>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                {i === segments.length - 1 ? (
                  <BreadcrumbPage className="truncate">{seg}</BreadcrumbPage>
                ) : (
                  <span className="truncate text-muted-foreground">{seg}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      {surface === "editor" && path !== null && <NoteMenu path={path} />}
    </header>
  );
}

function NavButton({
  label,
  hint,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      title={hint}
      disabled={disabled}
      onClick={onClick}
      className="app-no-drag size-7 px-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
    >
      {icon}
    </Button>
  );
}

/** Every per-file action, behind one glyph. Page details is a Sheet the menu
 * OPENS rather than contains — a panel nested inside a menu closes with it. */
function NoteMenu({ path }: { path: string }) {
  const { deleteEntry } = useVaultActions();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canRich = useOpenNote((s) => richAvailable(s.openDoc));
  const surfaceMode = useOpenNote((s) =>
    s.openDoc.kind === "markdown" ? s.openDoc.surface.mode : null,
  );
  // Only Rich mode has a live editor to write frontmatter through.
  const markdownPath = useOpenNote((s) => (s.openDoc.kind === "markdown" ? s.openDoc.path : null));
  const detailsPath = surfaceMode === "rich" ? markdownPath : null;

  const confirmDelete = async () => {
    if (await confirmVaultDelete(path)) await deleteEntry(path);
  };

  return (
    <div className="app-no-drag flex shrink-0 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-label="Note actions"
              title="Note actions"
              className="size-7 px-0 text-muted-foreground hover:text-foreground"
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {canRich && (
            <>
              <DropdownMenuItem
                onClick={() => setOpenNoteMode(surfaceMode === "rich" ? "raw" : "rich")}
              >
                {surfaceMode === "rich" ? (
                  <PilcrowIcon className="size-4" />
                ) : (
                  <FileTextIcon className="size-4" />
                )}
                {surfaceMode === "rich" ? "Edit as markdown" : "Edit as rich text"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {detailsPath !== null && (
            <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
              <InfoIcon className="size-4" />
              Page details
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => void confirmDelete()}>
            <Trash2Icon className="size-4" />
            Delete note
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {detailsPath !== null && (
        <PageDetails
          key={detailsPath}
          path={detailsPath}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      )}
    </div>
  );
}
