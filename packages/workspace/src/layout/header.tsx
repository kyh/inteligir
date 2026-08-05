import { Fragment } from "react";
import { LockIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/ui/components/breadcrumb";
import { SidebarTrigger, useSidebar } from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";

import { confirmVaultDelete } from "@repo/workspace/components/confirm-vault-delete";
import { describeGateReason } from "@repo/editor/markdown/markdown-doc";
import { PageDetails } from "@repo/editor/properties/page-details";
import { richAvailable } from "@repo/editor/note/open-doc";
import { useOpenNote } from "@repo/editor/note/open-note-store";
import { useVaultActions, useVaultListing } from "@repo/editor/host";

/**
 * The shell header — a single sticky toolbar over the editor card. Left: the
 * sidebar toggle + a breadcrumb of the open note's vault path. Right: the
 * per-file controls (raw-rich / page details / delete; save status lives in
 * the bottom-right SaveIndicator dot). Also the
 * window drag region. When the sidebar is collapsed the card slides under the
 * macOS traffic lights, so we pad the left to keep the toggle clear of them.
 */
export function Header() {
  const { folderName } = useVaultListing();
  const { setMode, deleteEntry, showHtmlAsApp } = useVaultActions();
  // Narrow selectors: every value here is a primitive (or the gate
  // reason, which changes only per saved-content re-analysis), so typing in
  // the note never re-renders the header — only privacy/surface/path flips do.
  const path = useOpenNote((s) => s.editor.path);
  const openIsHtml = useOpenNote((s) => s.openIsHtml);
  const isHtmlApp = useOpenNote((s) => s.isHtmlApp);
  const isPrivate = useOpenNote((s) => s.openDoc.kind === "markdown" && s.openDoc.isPrivate);
  const surfaceMode = useOpenNote((s) =>
    s.openDoc.kind === "markdown" ? s.openDoc.surface.mode : null,
  );
  const rawReason = useOpenNote((s) =>
    s.openDoc.kind === "markdown" && s.openDoc.surface.mode === "raw"
      ? s.openDoc.surface.reason
      : null,
  );
  const canRich = useOpenNote((s) => richAvailable(s.openDoc));
  const markdownPath = useOpenNote((s) => (s.openDoc.kind === "markdown" ? s.openDoc.path : null));
  // Only Rich mode has a live editor to write frontmatter through.
  const pageDetailsPath = surfaceMode === "rich" ? markdownPath : null;
  const { state } = useSidebar();
  const segments = path ? path.split("/") : [];

  const confirmDelete = async () => {
    if (path && (await confirmVaultDelete(path))) await deleteEntry(path);
  };

  return (
    <header
      className={cn(
        "app-drag sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 bg-background px-3",
        state === "collapsed" && "pl-20",
      )}
    >
      <SidebarTrigger className="app-no-drag -ml-1 text-muted-foreground" />

      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            <span className="text-muted-foreground">{folderName || "Vault"}</span>
          </BreadcrumbItem>
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

      {path !== null && (
        <div className="app-no-drag flex shrink-0 items-center gap-1.5">
          {openIsHtml && !isHtmlApp && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={showHtmlAsApp}
            >
              Open as app
            </Button>
          )}
          {isPrivate && (
            <Badge
              variant="outline"
              className="text-muted-foreground"
              title="Private — excluded from AI features on this device"
            >
              <LockIcon className="size-3" />
              Private
            </Badge>
          )}
          {rawReason !== null && (
            <Badge
              variant="outline"
              className="text-muted-foreground"
              title={describeGateReason(rawReason)}
            >
              Raw
            </Badge>
          )}
          {canRich && (
            <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
              {(["raw", "rich"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={surfaceMode === m}
                  className={cn(
                    "rounded px-2 py-0.5 capitalize transition-colors",
                    surfaceMode === m
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {pageDetailsPath !== null && <PageDetails key={pageDetailsPath} path={pageDetailsPath} />}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void confirmDelete()}
            className="size-7 px-0 text-muted-foreground hover:text-destructive"
            title="Delete note"
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      )}
    </header>
  );
}
