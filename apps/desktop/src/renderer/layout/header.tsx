import { Fragment } from "react";
import { Trash2Icon, WandSparklesIcon } from "lucide-react";

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

import { useVault } from "@/renderer/workspace/vault-context";

/**
 * The shell header — a single sticky toolbar over the editor card. Left: the
 * sidebar toggle + a breadcrumb of the open note's vault path. Right: the
 * per-file controls (Format / raw-rich / save status / delete). Also the window
 * drag region. When the sidebar is collapsed the card slides under the macOS
 * traffic lights, so we pad the left to keep the toggle clear of them.
 */
export function Header() {
  const {
    editor,
    folderName,
    isMarkdownOpen,
    canonical,
    richSafe,
    mode,
    setMode,
    formatDoc,
    deleteEntry,
  } = useVault();
  const { state } = useSidebar();
  const path = editor.path;
  const segments = path ? path.split("/") : [];

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
          {isMarkdownOpen && richSafe && !canonical && (
            <Button
              variant="tertiary"
              size="sm"
              onClick={formatDoc}
              title="Tidy formatting to canonical markdown so future edits stay byte-stable"
              className="h-7 gap-1 px-2 text-xs"
            >
              <WandSparklesIcon className="size-3.5" />
              Format
            </Button>
          )}
          {isMarkdownOpen && richSafe && (
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
          <Badge variant="dot" className="text-muted-foreground">
            {editor.saving ? "Saving…" : editor.dirty ? "Unsaved" : "Saved"}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm(`Delete ${path}?`)) void deleteEntry(path);
            }}
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
