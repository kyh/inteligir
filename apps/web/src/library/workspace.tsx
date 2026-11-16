// The library's page: the rail of scopes, the grid of the scope or the item open in its place, and
// the right panel (Info, the agent), over the account's library cell. Every screen reads the cell
// through the page's queries and writes through its mutations, so each needs a connection and says
// so without one. A link or a file pasted or dropped where no field takes it is saved where the
// grid's scope saves. Where the tab is rides the url, the grid's scope and kind and the item open
// over them, so a reload, Back and a link all open it.

import { viewContextOf } from "@repo/client/agent-send";
import type { AgentViewContext } from "@repo/client/agent-send";
import { saveFolderOf, scopeTitle } from "@repo/client/library-labels";
import { listingView } from "@repo/client/listing-view";
import { listedScope } from "@repo/contract/library-scope";
import type { LibraryScope } from "@repo/contract/library-scope";
import { setLibraryTitles } from "@repo/editor/host-io";
import type { OpenNote } from "@repo/editor/item/item-editor";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { isWebUrl } from "@repo/contract/items/item-url";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Sidebar } from "@repo/ui/components/sidebar";
import { SidebarInset, SidebarProvider } from "@repo/ui/components/sidebar-core";
import type { SidebarActions } from "@repo/ui/components/sidebar-core";
import { toast } from "@repo/ui/components/sonner";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { plural } from "@repo/ui/lib/plural";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { useStore } from "zustand";

import { useLibraryQueries, usePageLibrary } from "./cloud/library-context";
import { cellStanding } from "./cloud/needs-connection";
import { COMPOSER_START, composerAfter } from "./agent/agent-composer";
import { refusalText } from "@repo/contract/refusal-text";
import { bindingFor, useWindowShortcuts } from "./shortcuts";
import { ItemView } from "./item/item-view";
import { useLeaveItem } from "./item/leave-item";
import { installPageEditorHost } from "./item/page-editor-host";
import { filesPayload } from "./library/capture/capture-payload";
import type { CapturePayload } from "./library/capture/capture-payload";
import { useWindowCapture } from "./library/capture/window-capture";
import { askFolder, askName, askTags } from "./library/ask";
import type { LibraryGridActions } from "./library/item-menu";
import { createLibrarySelection } from "./library/library-selection";
import { useLibraryVerbs } from "./library/library-verbs";
import type { NoteMade } from "./library/library-verbs";
import { LibraryView } from "./library/library-view";
import { listingQuery, saveTagsOf } from "./library/listing";
import { CommandPalette } from "./palette/command-palette";
import { Panel } from "./panel/panel";
import type { PanelTab } from "./panel/panel";
import { usePref, windowLayout } from "./prefs";
import { Rail } from "./sidebar/rail";

export interface WorkspaceProps {
  // where the tab is, as its address says
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
  readonly openItem: string | null;
  // another surface draws over the workspace: it goes inert and its window-level chords stand down
  readonly covered: boolean;
}

// a bulk delete this large asks first; any fewer go at once, each recoverable from Deleted
const DELETE_ASKS_OVER = 50;

// what a tag's verb acts on: each item and the tags its own field holds, which it can take off
interface TagSubject {
  readonly id: string;
  readonly tags: readonly string[];
}

export const Workspace = ({ scope: addressed, kind, openItem, covered }: WorkspaceProps) => {
  const { cloud, socket, wire } = usePageLibrary();
  const queries = useLibraryQueries();
  const queryClient = useQueryClient();
  const verbs = useLibraryVerbs();
  const navigate = useNavigate();
  const modifier = platformShortcutModifier();
  const [sort, setSort] = usePref(windowLayout, "librarySort");
  const [panelOpen, setPanelOpen] = usePref(windowLayout, "panelOpen");
  const [panelWidth, setPanelWidth] = usePref(windowLayout, "panelWidth");
  const [railOpen, setRailOpen] = usePref(windowLayout, "railOpen");
  const [railWidth, setRailWidth] = usePref(windowLayout, "railWidth");
  const [tab, setTab] = useState<PanelTab>("info");
  const [composer, dispatchComposer] = useReducer(composerAfter, COMPOSER_START);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [selection] = useState(createLibrarySelection);
  const noteRef = useRef<OpenNote | null>(null);
  useLeaveItem(noteRef);
  const filesRef = useRef<HTMLInputElement | null>(null);
  // the window's chord asks the rail, which below the breakpoint opens a sheet instead
  const railRef = useRef<SidebarActions | null>(null);

  // the selection as it changes, which the panel's Info follows
  const selected = useStore(selection.store, (state) => state.selected);
  const counts = useQuery(queries.scopes()).data;
  const folders = counts?.folders ?? [];
  // an addressed folder is judged once the rail's folders have answered
  const scope = counts === undefined ? addressed : listedScope(addressed, folders);
  const scopeName = scopeTitle(scope, folders, "All items");
  const listing = useInfiniteQuery(queries.listing(listingQuery({ kind, scope, sort })));
  const view = listingView(listing.data?.pages ?? []);
  const titles = useQuery(queries.titles()).data;

  // on the current route, so an open that lands while Settings covers the workspace keeps it; the
  // item already open is replaced, so a hit found in it adds no entry to go Back through
  const open = (
    itemId: string | null,
    { find, ignoreBlocker }: { find?: string; ignoreBlocker?: boolean } = {},
  ): void => {
    void navigate({
      ignoreBlocker,
      replace: itemId === openItem,
      search: (prior) => ({ ...prior, find, item: itemId ?? undefined }),
      to: ".",
    });
  };

  // a new entry with no kind and no item, so Back walks scopes and the leave guard asks once; All
  // items is the bare address, which a fresh tab opens on
  const showScope = (next: LibraryScope): void => {
    void navigate({ search: { scope: next.kind === "all" ? undefined : next }, to: "/library" });
  };

  // a narrowing of the scope, not a place of its own, so it replaces the entry Back would return to
  const showKind = (next: ItemKind | null): void => {
    void navigate({
      replace: true,
      search: (prior) => ({ ...prior, kind: next ?? undefined }),
      to: ".",
    });
  };

  const revealPanel = (next: PanelTab): void => {
    setTab(next);
    setPanelOpen(true);
  };

  const startTidy = (): void => {
    dispatchComposer({ kind: "tidy" });
    revealPanel("agent");
  };
  // offered while something waits to be filed or tagged
  const tidyOffered = counts !== undefined && counts.unsorted + counts.untagged > 0;

  // the editor's host, made once for the page: links open items, a note the editor makes lands
  // beside the item open now, and "Ask the agent" quotes the passage in the panel's composer
  const hostAsksAgent = useEffectEvent((asked: string) => {
    revealPanel("agent");
    dispatchComposer({ kind: "asked", passage: asked });
  });
  const hostOpens = useEffectEvent((itemId: string) => {
    open(itemId);
  });
  const hostShowsTag = useEffectEvent((tag: string) => {
    showScope({ kind: "tag", tag });
  });
  // in the folder of the item open now, whose row its view has read
  const hostMakesNote = useEffectEvent(async (made: NoteMade): Promise<string> => {
    const beside =
      openItem === null ? undefined : queryClient.getQueryData(queries.item(openItem).queryKey);
    return await verbs.createNote({ folderId: beside?.fields.folderId ?? null, tags: [] }, made);
  });
  // installed as the workspace first renders: an open item's editor reads the host as it renders,
  // and the workspace's effects run after its children's first render
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [host] = useState(() => installPageEditorHost({ cloud, socket, wire }));
  useEffect(() => {
    host.bind({
      askAgent: hostAsksAgent,
      createNote: hostMakesNote,
      openItem: hostOpens,
      showTag: hostShowsTag,
    });
    return () => {
      host.bind(null);
    };
  }, [host]);
  useEffect(() => {
    if (titles !== undefined) {
      setLibraryTitles(titles.targets);
    }
  }, [titles]);

  // a scope opens with nothing selected however the tab reached it, a row, a tag or Back, since the
  // prune below waits for the scope's listing and keeps an id both scopes list
  const scopeKey = JSON.stringify(scope);
  const selectedIn = useRef(scopeKey);
  useEffect(() => {
    if (selectedIn.current !== scopeKey) {
      selectedIn.current = scopeKey;
      selection.apply({ kind: "clear" });
    }
  }, [scopeKey, selection]);

  // a selected item that left the listing (deleted, moved out of the scope) leaves the selection
  const listed = view?.items;
  useEffect(() => {
    if (listed === undefined) {
      return;
    }
    const ids = new Set(listed.map((row) => row.id));
    const gone = [...selection.store.getState().selected].filter((id) => !ids.has(id));
    if (gone.length > 0) {
      selection.apply({ gone: new Set(gone), kind: "prune" });
    }
  }, [listed, selection]);

  const openSettings = (): void => {
    void navigate({ search: true, to: "/library/settings" });
  };

  useWindowShortcuts({ enabled: !covered, modifier }, (action) => {
    switch (action) {
      case "open-agent": {
        revealPanel("agent");
        break;
      }
      case "open-palette": {
        setPaletteOpen(true);
        break;
      }
      case "open-settings": {
        openSettings();
        break;
      }
      case "toggle-panel": {
        setPanelOpen(!panelOpen);
        break;
      }
      case "toggle-rail": {
        railRef.current?.toggle();
        break;
      }
      // no default
    }
  });

  const into = () => ({ folderId: saveFolderOf(scope), tags: saveTagsOf(scope) });

  const newNote = (): void => {
    void (async () => {
      try {
        open(await verbs.createNote(into()));
      } catch (error) {
        toast.error(refusalText(error, "The note couldn't be made."));
      }
    })();
  };

  const saveLink = (url: string): void => {
    void verbs.saveLinks([{ title: null, url }], into(), open);
  };

  // what a paste, a drop or the file picker handed over: each file and each link saved where the
  // grid's scope saves, and what could not be taken said
  const savePayload = (payload: CapturePayload): void => {
    for (const sentence of payload.refused) {
      toast.error(sentence);
    }
    void verbs.saveLinks(payload.urls, into(), open);
    void verbs.addFiles(payload.files, into());
  };

  const { catcherRef, dropInto } = useWindowCapture({
    enabled: !covered,
    into: () => (scope.kind === "folder" ? scopeName : "Unsorted"),
    modifier,
    onCapture: savePayload,
  });

  const askSaveLink = (): void => {
    void (async () => {
      const address = await askName({
        confirm: "Save",
        initial: "",
        label: "The page's address",
        refuse: (typed) =>
          isWebUrl(typed) ? null : "Type the whole address, starting with https://",
        title: "Save a link",
      });
      if (address !== null) {
        saveLink(address);
      }
    })();
  };

  const newFolder = (parentId: string | null): void => {
    void (async () => {
      const name = await askName({
        confirm: "Create",
        initial: "",
        label: "Folder name",
        title: "New folder",
      });
      if (name !== null) {
        verbs.createFolder(name, parentId);
      }
    })();
  };

  const removeItems = (ids: readonly string[]): void => {
    void (async () => {
      if (
        ids.length > DELETE_ASKS_OVER &&
        !(await confirm({
          body: "They wait in Deleted, where you can restore them.",
          confirmLabel: "Delete",
          destructive: true,
          title: `Delete ${plural(ids.length, "item")}?`,
        }))
      ) {
        return;
      }
      // deleted on the person's word, so its leave asks nothing
      if (openItem !== null && ids.includes(openItem)) {
        open(null, { ignoreBlocker: true });
      }
      await verbs.remove(ids);
    })();
  };

  const purge = (ids: readonly string[]): void => {
    void (async () => {
      if (
        !(await confirm({
          body: "Their text and files are gone for good. This can't be undone.",
          confirmLabel: "Delete forever",
          destructive: true,
          title: `Delete ${plural(ids.length, "item")} forever?`,
        }))
      ) {
        return;
      }
      await verbs.purge(ids);
    })();
  };

  const emptyDeleted = (): void => {
    void (async () => {
      let ids: string[];
      try {
        ids = await verbs.deletedIds();
      } catch (error) {
        toast.error(refusalText(error, "Deleted couldn't be read."));
        return;
      }
      if (ids.length > 0) {
        purge(ids);
      }
    })();
  };

  const askMove = (ids: readonly string[]): void => {
    void (async () => {
      const picked = await askFolder({ count: ids.length });
      if (picked !== null) {
        await verbs.move(ids, picked.folderId);
      }
    })();
  };

  const askTag = (subjects: readonly TagSubject[]): void => {
    // the tags every subject carries, which the dialog offers to take off
    let held: string[] = [...(subjects[0]?.tags ?? [])];
    for (const subject of subjects.slice(1)) {
      held = held.filter((tag) => subject.tags.includes(tag));
    }
    void (async () => {
      const change = await askTags({ count: subjects.length, held });
      if (change !== null) {
        await verbs.tag(
          subjects.map((subject) => subject.id),
          change,
        );
      }
    })();
  };

  const actions: LibraryGridActions = {
    askAgent: (rows) => {
      selection.apply({ kind: "all", order: rows.map((row) => row.id) });
      revealPanel("agent");
    },
    move: (rows) => {
      askMove(rows.map((row) => row.id));
    },
    open: (row) => {
      open(row.id);
    },
    pin: (rows, pinned) => {
      void verbs.pin(
        rows.map((row) => row.id),
        pinned,
      );
    },
    purge: (rows) => {
      purge(rows.map((row) => row.id));
    },
    refresh: (row) => {
      verbs.refresh(row.id);
    },
    remove: (rows) => {
      removeItems(rows.map((row) => row.id));
    },
    restore: (rows) => {
      void verbs.restore(rows.map((row) => row.id));
    },
    tag: (rows) => {
      askTag(rows.map((row) => ({ id: row.id, tags: row.fields.tags })));
    },
  };

  // what the agent is told about the screen a message leaves from
  const viewContext = (): AgentViewContext | undefined =>
    viewContextOf({ kind, openItem, scope, selected: [...selection.store.getState().selected] });

  // the panel's item: the open one, else the one card selected
  const [onlySelected = null, ...moreSelected] = selected;
  const panelItem = openItem ?? (moreSelected.length === 0 ? onlySelected : null);

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
            <Rail
              scope={scope}
              itemOpen={openItem !== null}
              onScope={showScope}
              onOpenSearch={() => {
                setPaletteOpen(true);
              }}
              onOpenSettings={openSettings}
              folders={{
                create: newFolder,
                remove: (folderId, name) => {
                  void (async () => {
                    if (
                      await confirm({
                        body: "Its items move to Unsorted.",
                        confirmLabel: "Delete folder",
                        destructive: true,
                        title: `Delete the folder “${name}”?`,
                      })
                    ) {
                      verbs.deleteFolder(folderId);
                    }
                  })();
                },
                rename: (folderId, name) => {
                  void (async () => {
                    const next = await askName({
                      confirm: "Rename",
                      initial: name,
                      label: "Folder name",
                      title: "Rename folder",
                    });
                    if (next !== null) {
                      verbs.renameFolder(folderId, next);
                    }
                  })();
                },
              }}
            />
          </Sidebar>
          <SidebarInset className="relative bg-surface">
            <SidebarProvider
              className="h-full min-h-0 flex-1"
              open={panelOpen}
              onOpenChange={setPanelOpen}
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
                      standing: cellStanding({
                        data: view,
                        error: listing.error,
                        fetchStatus: listing.fetchStatus,
                      }),
                    }}
                    kind={kind}
                    onKindChange={showKind}
                    sort={sort}
                    onSortChange={setSort}
                    selection={selection}
                    actions={actions}
                    add={{
                      addFiles: () => {
                        filesRef.current?.click();
                      },
                      newFolder: () => {
                        newFolder(saveFolderOf(scope));
                      },
                      newNote,
                      saveLink: askSaveLink,
                    }}
                    onEmptyDeleted={emptyDeleted}
                    onTidy={tidyOffered ? startTidy : null}
                  />
                ) : (
                  <ItemView
                    itemId={openItem}
                    onBack={() => {
                      open(null);
                    }}
                    onTogglePanel={() => {
                      setPanelOpen(!panelOpen);
                    }}
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
                  tab={tab}
                  onTab={setTab}
                  composer={composer}
                  dispatchComposer={dispatchComposer}
                  viewContext={viewContext}
                  flushOpen={async () => {
                    await noteRef.current?.holds();
                  }}
                  infoActions={{
                    move: (itemId) => {
                      askMove([itemId]);
                    },
                    tag: (itemId, tags) => {
                      askTag([{ id: itemId, tags }]);
                    },
                  }}
                />
              </Sidebar>
            </SidebarProvider>
          </SidebarInset>
        </SidebarProvider>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={{
          askAgent: () => {
            revealPanel("agent");
          },
          askSaveLink,
          newNote,
          openHit: (itemId, find) => {
            open(itemId, { find });
          },
          openSettings,
          saveLink,
          startTidy,
        }}
      />
      <textarea
        ref={catcherRef}
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none fixed -top-full left-0 size-px opacity-0"
      />
      <input
        ref={filesRef}
        type="file"
        multiple
        hidden
        aria-label="Add files"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length > 0) {
            savePayload(filesPayload(files));
          }
        }}
      />
    </>
  );
};
