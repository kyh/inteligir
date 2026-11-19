import { viewContextOf } from "@repo/client/agent-send";
import { scopeTitle } from "@repo/client/library-labels";
import { listingView } from "@repo/client/listing-view";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { OpenNote } from "@repo/editor/item/item-editor";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { Sidebar } from "@repo/ui/components/sidebar";
import { SidebarInset, SidebarProvider } from "@repo/ui/components/sidebar-core";
import type { SidebarActions } from "@repo/ui/components/sidebar-core";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { useLibraryQueries, usePageLibrary } from "./cloud/library-context";
import { cellStanding } from "./cloud/needs-connection";
import { bindingFor, useWindowShortcuts } from "./shortcuts";
import { ItemView } from "./item/item-view";
import { useLeaveItem } from "./item/leave-item";
import { useWindowCapture } from "./library/capture/window-capture";
import { useLibraryCommands } from "./library/library-commands";
import { createLibrarySelection, selectedIn } from "./library/library-selection";
import { LibraryView } from "./library/library-view";
import type { ListingPlaceholder } from "./library/library-view";
import { listingQuery } from "./library/listing";
import { CommandPalette } from "./palette/command-palette";
import { Panel } from "./panel/panel";
import { usePref, windowLayout } from "./prefs";
import { Rail } from "./sidebar/rail";

const NOTHING_LISTED = { items: [], total: 0 };

export interface WorkspaceProps {
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
  readonly openItem: string | null;
  readonly covered: boolean;
}

export const Workspace = ({ scope, kind, openItem, covered }: WorkspaceProps) => {
  const { workspace } = usePageLibrary();
  const queries = useLibraryQueries();
  const commands = useLibraryCommands();
  const modifier = platformShortcutModifier();
  const [sort, setSort] = usePref(windowLayout, "librarySort");
  const [panelOpen, setPanelOpen] = usePref(windowLayout, "panelOpen");
  const [panelWidth, setPanelWidth] = usePref(windowLayout, "panelWidth");
  const [railOpen, setRailOpen] = usePref(windowLayout, "railOpen");
  const [railWidth, setRailWidth] = usePref(windowLayout, "railWidth");
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [selection] = useState(createLibrarySelection);
  const noteRef = useRef<OpenNote | null>(null);
  useLeaveItem(noteRef);
  const railRef = useRef<SidebarActions | null>(null);

  const folders = useQuery(queries.scopes()).data?.folders ?? [];
  const scopeName = scopeTitle(scope, folders, "All items");
  const listing = useInfiniteQuery(queries.listing(listingQuery({ kind, scope, sort })));
  const view = listingView(listing.data?.pages ?? []);
  const scopeKey = JSON.stringify(scope);
  const [listedScope, setListedScope] = useState(scopeKey);

  if (!listing.isPlaceholderData && listedScope !== scopeKey) {
    setListedScope(scopeKey);
  }

  let placeholder: ListingPlaceholder = null;

  if (listing.isPlaceholderData) {
    placeholder = listedScope === scopeKey ? "same-scope" : "other-scope";
  }

  const selected = useStore(selection.store, (state) => state.selected);
  const picked = selectedIn(selected, view ?? NOTHING_LISTED);

  const selectedUnder = useRef(scopeKey);
  useEffect(() => {
    if (selectedUnder.current !== scopeKey) {
      selectedUnder.current = scopeKey;
      selection.apply({ kind: "clear" });
    }
  }, [scopeKey, selection]);

  const spent =
    selected.kind === "scope" && view !== undefined && view.total <= selected.except.size;

  useEffect(() => {
    if (spent) {
      selection.apply({ kind: "clear" });
    }
  }, [spent, selection]);

  useWindowShortcuts({ enabled: !covered, modifier }, (action) => {
    switch (action) {
      case "open-agent": {
        commands.askAgent();
        break;
      }

      case "open-palette": {
        commands.openPalette();
        break;
      }

      case "open-settings": {
        commands.openSettings();
        break;
      }

      case "toggle-panel": {
        workspace.togglePanel();
        break;
      }

      case "toggle-rail": {
        railRef.current?.toggle();
        break;
      }

      default: {
        throw new Error(`unexpected ${String(action satisfies never)}`);
      }
    }
  });

  const { catcherRef, dropInto } = useWindowCapture({
    enabled: !covered,
    into: () => (scope.kind === "folder" ? scopeName : "Unsorted"),
    modifier,
    onCapture: commands.save,
  });

  const viewContext = () => {
    const told = placeholder === null ? picked : selectedIn(selected, NOTHING_LISTED);

    return viewContextOf({
      kind,
      openItem,
      scope,
      selected: { count: told.count, ids: told.rows.map((row) => row.id) },
    });
  };

  const panelItem = openItem ?? (picked.count === 1 ? (picked.rows[0]?.id ?? null) : null);

  return (
    <>
      <div className="h-dvh" inert={covered}>
        <SidebarProvider
          className="h-full"
          open={railOpen}
          onOpenChange={setRailOpen}
          actionsRef={railRef}
          shortcut={bindingFor("toggle-rail", modifier)}
          defaultWidth={`${String(railWidth)}px`}
          onWidthCommitted={setRailWidth}
        >
          <Sidebar variant="floating" label="Sidebar" className="h-full print:hidden">
            <Rail scope={scope} itemOpen={openItem !== null} />
          </Sidebar>
          <SidebarInset className="relative bg-surface">
            <SidebarProvider
              className="h-full min-h-0 flex-1"
              open={panelOpen}
              onOpenChange={setPanelOpen}
              actionsRef={workspace.panel}
              shortcut={bindingFor("toggle-panel", modifier)}
              defaultWidth={`${String(panelWidth)}px`}
              onWidthCommitted={setPanelWidth}
            >
              <SidebarInset className="relative bg-surface">
                {openItem === null ? (
                  <LibraryView
                    scope={scope}
                    title={scopeName}
                    listing={{
                      more: () => {
                        if (listing.hasNextPage && !listing.isFetchingNextPage) {
                          void listing.fetchNextPage();
                        }
                      },
                      placeholder,
                      standing: cellStanding({
                        data: view,
                        error: listing.error,
                        fetchStatus: listing.fetchStatus,
                      }),
                    }}
                    kind={kind}
                    sort={sort}
                    onSortChange={setSort}
                    selection={selection}
                  />
                ) : (
                  <ItemView
                    itemId={openItem}
                    onNote={(opened) => {
                      noteRef.current = opened;
                    }}
                  />
                )}
                {dropInto === null ? null : (
                  <div
                    aria-live="polite"
                    className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-surface/80 text-title font-medium text-ink"
                  >
                    Drop to save to {dropInto}
                  </div>
                )}
              </SidebarInset>
              <Sidebar side="right" label="Panel" className="h-full print:hidden">
                <Panel
                  itemId={panelItem}
                  viewContext={viewContext}
                  flushOpen={async () => {
                    await noteRef.current?.holds();
                  }}
                />
              </Sidebar>
            </SidebarProvider>
          </SidebarInset>
        </SidebarProvider>
      </div>
      <CommandPalette />
      <textarea
        ref={catcherRef}
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none fixed -top-full left-0 size-px opacity-0"
      />
    </>
  );
};
