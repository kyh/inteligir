import { Fragment } from "react";
import { Trash2Icon } from "lucide-react";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/ui/components/breadcrumb";
import { SidebarTrigger, useSidebar } from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";

import { describeRawReason } from "@repo/app/editor/markdown/markdown-doc";
import { useAiReviewStore } from "@repo/app/stores/ai-review-store";
import { useVault } from "@repo/app/workspace/vault-context";

/**
 * The shell header — a single sticky toolbar over the editor card. Left: the
 * sidebar toggle + a breadcrumb of the open note's vault path. Right: the
 * per-file controls (raw-rich / save status / delete). Also the window
 * drag region. When the sidebar is collapsed the card slides under the macOS
 * traffic lights, so we pad the left to keep the toggle clear of them.
 */
export function Header() {
  const {
    editor,
    folderName,
    isMarkdownOpen,
    richAvailable,
    rawReason,
    mode,
    setMode,
    deleteEntry,
  } = useVault();
  const { state } = useSidebar();
  const path = editor.path;
  // While an AI suggestion session pends ON THIS note, its autosave is frozen
  // (the transient gate) — say so instead of silently reading "Saved" over
  // stale bytes.
  const reviewingPaths = useAiReviewStore((s) => s.reviewing);
  const reviewing = path !== null && reviewingPaths.has(path);
  const segments = path ? path.split("/") : [];

  const confirmDelete = async () => {
    if (!path) return;
    const confirmed = await confirm({
      title: `Delete ${path}?`,
      body: "This permanently deletes the file from your vault.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (confirmed) await deleteEntry(path);
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
          {isMarkdownOpen && rawReason !== null && (
            <Badge
              variant="dot"
              className="text-muted-foreground"
              title={describeRawReason(rawReason)}
            >
              Raw
            </Badge>
          )}
          {richAvailable && (
            <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
              {(["raw", "rich"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={cn(
                    "rounded px-2 py-0.5 capitalize transition-colors",
                    mode === m
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          <Badge
            variant="dot"
            className="text-muted-foreground"
            title={
              reviewing
                ? "Saving is paused while AI suggestions await review — resolve or leave to settle them"
                : undefined
            }
          >
            {reviewing
              ? "Reviewing suggestions"
              : editor.saving
                ? "Saving…"
                : editor.dirty
                  ? "Unsaved"
                  : "Saved"}
          </Badge>
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
