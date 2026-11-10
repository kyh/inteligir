// The library's page: the rail of scopes, the grid of the scope or the item open in its place, and
// the right panel (Info, the agent), over the account's library cell. Every screen reads the cell
// through the page's queries and writes through its mutations, so each needs a connection and says
// so without one. A link or a file pasted or dropped where no field takes it is saved where the
// grid's scope saves. The open item rides the url (`?item=<id>`), so a reload, Back and a link all
// open it.

import { viewContextOf } from "@repo/agent-panel/agent-send";
import type { AgentViewContext } from "@repo/agent-panel/agent-send";
import { listedScope } from "@repo/contract/library-scope";
import type { LibraryScope } from "@repo/contract/library-scope";
import { jumpToFindMatch } from "@repo/editor/find-bar";
import { setLibraryTitles } from "@repo/editor/host-io";
import type { OpenNote } from "@repo/editor/item/item-editor";
import { getLiveEditor, onLiveEditor } from "@repo/editor/live-editor";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { isWebUrl } from "@repo/contract/items/item-url";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Sidebar } from "@repo/ui/components/sidebar";
import { SidebarInset, SidebarProvider } from "@repo/ui/components/sidebar-core";
import type { SidebarActions } from "@repo/ui/components/sidebar-core";
import { toast } from "@repo/ui/components/sonner";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { plural } from "@repo/ui/lib/plural";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useStore } from "zustand";

import {
  useCloud,
  useLeaveGuard,
  useLibraryQueries,
  useSocket,
  useWire,
} from "./cloud/library-context";
import { refusalText } from "@repo/contract/refusal-text";
import { bindingFor, useGlobalShortcuts } from "./global-shortcuts";
import { ItemView } from "./item/item-view";
import { leaveItem, noteHolds } from "./item/leave-item";
import { installPageEditorHost } from "./item/page-editor-host";
import type { PageEditorHost } from "./item/page-editor-host";
import { filesPayload } from "./library/capture/capture-payload";
import type { CapturedLink, CapturePayload } from "./library/capture/capture-payload";
import { useWindowCapture } from "./library/capture/window-capture";
import { MoveDialog, NameDialog, TagDialog } from "./library/item-dialogs";
import type { MoveRequest, NameRequest, TagRequest } from "./library/item-dialogs";
import type { LibraryGridActions } from "./library/item-menu";
import { createLibrarySelection } from "./library/library-selection";
import { useLibraryVerbs } from "./library/library-verbs";
import { LibraryView } from "./library/library-view";
import { listingQuery, listingView, saveFolderOf, saveTagsOf, scopeTitle } from "./library/listing";
import { CommandPalette } from "./palette/command-palette";
import { Panel } from "./panel/panel";
import type { PanelTab } from "./panel/panel";
import { PREFS, readPref, usePref, writePref } from "./prefs";
import { Rail } from "./sidebar/rail";

export interface WorkspaceProps {
  readonly openItem: string | null;
  readonly onOpenItem: (itemId: string | null) => void;
  // another surface draws over the workspace: it goes inert and its window-level chords stand down
  readonly covered: boolean;
}

// a bulk delete this large asks first; any fewer go at once, each recoverable from Deleted
const DELETE_ASKS_OVER = 50;

// a search's words, which the item it opened lands its find bar on once its note has synced
interface PendingFind {
  readonly itemId: string;
  readonly stop: () => void;
}

// what a tag's verb acts on: each item and the tags its own field holds, which it can take off
interface TagSubject {
  readonly id: string;
  readonly tags: readonly string[];
}

export const Workspace = ({ openItem, onOpenItem, covered }: WorkspaceProps) => {
  const wire = useWire();
  const cloud = useCloud();
  const socket = useSocket();
  const queries = useLibraryQueries();
  const verbs = useLibraryVerbs();
  const navigate = useNavigate();
  const modifier = platformShortcutModifier();
  const [storedScope, storeScope] = usePref(PREFS.libraryScope);
  const [sort, setSort] = usePref(PREFS.librarySort);
  const [panelOpen, setPanelOpen] = usePref(PREFS.panelOpen);
  const [kind, setKind] = useState<ItemKind | null>(null);
  const [tab, setTab] = useState<PanelTab>("info");
  const [threadId, setThreadId] = useState<string | null>(null);
  // the agent's composer holds Tidy my library's request, on a conversation of its own
  const [tidying, setTidying] = useState(false);
  // a passage the editor asked the agent about, until the composer takes it
  const [passage, setPassage] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moveRequest, setMoveRequest] = useState<MoveRequest | null>(null);
  const [tagRequest, setTagRequest] = useState<TagRequest | null>(null);
  const [nameRequest, setNameRequest] = useState<NameRequest | null>(null);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [selection] = useState(createLibrarySelection);
  const noteRef = useRef<OpenNote | null>(null);
  const findRef = useRef<PendingFind | null>(null);
  // the open item's note, which the leave guard asks about what it holds
  const [note, setNote] = useState<OpenNote | null>(null);
  const hostRef = useRef<PageEditorHost | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);
  // the window's chord asks the rail, which below the breakpoint opens a sheet instead
  const railRef = useRef<SidebarActions | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  // the selection as it changes, which the panel's Info follows
  const selected = useStore(selection.store, (state) => state.selected);
  const counts = useQuery(queries.scopes()).data;
  const folders = counts?.folders ?? [];
  // a remembered folder is judged once the rail's folders have answered
  const scope = counts === undefined ? storedScope : listedScope(storedScope, folders);
  const listing = useInfiniteQuery(queries.listing(listingQuery({ kind, scope, sort })));
  const view = listingView(listing.data?.pages ?? []);
  const titles = useQuery(queries.titles()).data;

  const open = (itemId: string | null): void => {
    void (async () => {
      if (await leaveItem(noteRef.current, confirm)) {
        onOpenItem(itemId);
      }
    })();
  };

  const revealPanel = (next: PanelTab): void => {
    setTab(next);
    setPanelOpen(true);
  };

  const startTidy = (): void => {
    setThreadId(null);
    setTidying(true);
    revealPanel("agent");
  };

  // a conversation chosen while a Tidy waits to be sent lets the Tidy go
  const chooseThread = (next: string | null): void => {
    setThreadId(next);
    if (next !== null) {
      setTidying(false);
    }
  };
  // offered while something waits to be filed or tagged
  const tidyOffered = counts !== undefined && counts.unsorted + counts.untagged > 0;

  // the editor's host, made once for the page: links open items, a note the editor makes lands
  // beside the item open now, and "Ask the agent" quotes the passage in the panel's composer
  const hostAsksAgent = useEffectEvent((asked: string) => {
    setTidying(false);
    revealPanel("agent");
    setPassage(asked);
  });
  const hostOpens = useEffectEvent((itemId: string) => {
    open(itemId);
  });
  const hostShowsTag = useEffectEvent((tag: string) => {
    storeScope({ kind: "tag", tag });
    open(null);
  });
  useEffect(() => {
    hostRef.current = installPageEditorHost({
      askAgent: hostAsksAgent,
      cloud,
      openItem: hostOpens,
      showTag: hostShowsTag,
      socket,
      wire,
    });
    return () => {
      hostRef.current = null;
    };
  }, [cloud, socket, wire]);
  useEffect(() => {
    if (titles !== undefined) {
      setLibraryTitles(titles.targets);
    }
  }, [titles]);

  // CLAUDE.md § THE TAB ASKS BEFORE IT LOSES THE OPEN ITEM'S EDIT: an edit reaches the note as it is
  // typed, so the tab holds one only while it was typed with no connection to carry it
  const leave = useLeaveGuard();
  useEffect(
    () =>
      note === null ? undefined : leave.hold({ holding: note.unsent, onMove: note.subscribe }),
    [leave, note],
  );

  useEffect(() => {
    hostRef.current?.showing(openItem);
    // a search's find waits for the item it opened, and for no other
    if (findRef.current !== null && findRef.current.itemId !== openItem) {
      findRef.current.stop();
      findRef.current = null;
    }
  }, [openItem]);

  // lands the find bar on a search's words once the item's editor draws its synced note, a frame
  // after it first answers, since it answers before Plate has drawn the text
  const findOnceOpen = (itemId: string, query: string): void => {
    findRef.current?.stop();
    findRef.current = null;
    const pending = {
      itemId,
      stop: onLiveEditor(itemId, (editor) => {
        findRef.current = null;
        requestAnimationFrame(() => {
          jumpToFindMatch(editor, query, 0);
        });
      }),
    };
    if (getLiveEditor(itemId) === null) {
      findRef.current = pending;
    }
  };

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

  const chooseScope = (next: LibraryScope): void => {
    storeScope(next);
    setKind(null);
    selection.apply({ kind: "clear" });
    open(null);
  };

  const openSettings = (): void => {
    void navigate({ search: true, to: "/library/settings" });
  };

  useGlobalShortcuts({ enabled: !covered, modifier }, (action) => {
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

  const saveLinks = (links: readonly CapturedLink[]): void => {
    void (async () => {
      const made = [];
      const unsaved =
        links.length === 1 ? "That link couldn't be saved." : "Not every link could be saved.";
      for (const link of links) {
        try {
          made.push(await verbs.saveLink(link.url, link.title, into()));
        } catch (error) {
          toast.error(refusalText(error, unsaved));
          return;
        }
      }
      const [only, ...more] = made;
      if (only === undefined) {
        return;
      }
      if (more.length > 0) {
        toast.success(`Saved ${plural(made.length, "link")}.`);
        return;
      }
      toast.success(only.created ? "Saved." : "Your library already holds that link.", {
        action: {
          label: "Open",
          onClick: () => {
            open(only.id);
          },
        },
      });
    })();
  };

  const saveLink = (url: string): void => {
    saveLinks([{ title: null, url }]);
  };

  // what a paste, a drop or the file picker handed over: each file and each link saved where the
  // grid's scope saves, and what could not be taken said
  const savePayload = (payload: CapturePayload): void => {
    for (const sentence of payload.refused) {
      toast.error(sentence);
    }
    if (payload.urls.length > 0) {
      saveLinks(payload.urls);
    }
    if (payload.files.length > 0) {
      void (async () => {
        let made = 0;
        for (const file of payload.files) {
          try {
            await verbs.addFile(file, into());
          } catch (error) {
            toast.error(refusalText(error, "Not every file could be added."));
            break;
          }
          made += 1;
        }
        if (made > 0) {
          toast.success(`Added ${plural(made, "file")}.`);
        }
      })();
    }
  };

  const { catcherRef, dropInto } = useWindowCapture({
    enabled: !covered,
    into: () => (scope.kind === "folder" ? scopeTitle(scope, folders) : "Unsorted"),
    modifier,
    onCapture: savePayload,
  });

  const askSaveLink = (): void => {
    setNameRequest({
      confirm: "Save",
      initial: "",
      label: "The page's address",
      onSubmit: saveLink,
      refuse: (address) =>
        isWebUrl(address) ? null : "Type the whole address, starting with https://",
      title: "Save a link",
    });
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
      if (openItem !== null && ids.includes(openItem)) {
        onOpenItem(null);
      }
      let deleted: number;
      try {
        deleted = await verbs.remove(ids);
      } catch (error) {
        toast.error(refusalText(error, "That couldn't be deleted."));
        return;
      }
      toast.success(`Moved ${plural(deleted, "item")} to Deleted.`, {
        action: {
          label: "Undo",
          onClick: () => {
            verbs.restore(ids);
          },
        },
      });
    })();
  };

  const refreshCall = useMutation(
    wire.orpc.library.items.refresh.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "The page couldn't be read again."));
      },
      onSuccess: () => {
        toast.success("Reading the page again.");
      },
    }),
  );

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
    setMoveRequest({
      count: ids.length,
      onMove: (folderId) => {
        void verbs.move(ids, folderId);
      },
    });
  };

  const askTag = (subjects: readonly TagSubject[]): void => {
    // the tags every subject carries, which the dialog offers to take off
    let held: string[] = [...(subjects[0]?.tags ?? [])];
    for (const subject of subjects.slice(1)) {
      held = held.filter((tag) => subject.tags.includes(tag));
    }
    const ids = subjects.map((subject) => subject.id);
    setTagRequest({
      count: subjects.length,
      held,
      onChange: (change) => {
        void verbs.tag(ids, change);
      },
    });
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
      verbs.pin(
        rows.map((row) => row.id),
        pinned,
      );
    },
    purge: (rows) => {
      purge(rows.map((row) => row.id));
    },
    refresh: (row) => {
      refreshCall.mutate({ id: row.id });
    },
    remove: (rows) => {
      removeItems(rows.map((row) => row.id));
    },
    restore: (rows) => {
      verbs.restore(rows.map((row) => row.id));
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
          width={`${String(readPref(PREFS.sidebarWidth))}px`}
          onWidthCommitted={(px) => {
            writePref(PREFS.sidebarWidth, px);
          }}
        >
          <Sidebar variant="floating" label="Sidebar" className="h-full print:hidden">
            <Rail
              scope={scope}
              itemOpen={openItem !== null}
              onScope={chooseScope}
              onOpenSearch={() => {
                setPaletteOpen(true);
              }}
              onOpenSettings={openSettings}
              folders={{
                create: (parentId) => {
                  setNameRequest({
                    confirm: "Create",
                    initial: "",
                    label: "Folder name",
                    onSubmit: (name) => {
                      verbs.createFolder(name, parentId);
                    },
                    title: "New folder",
                  });
                },
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
                  setNameRequest({
                    confirm: "Rename",
                    initial: name,
                    label: "Folder name",
                    onSubmit: (next) => {
                      verbs.renameFolder(folderId, next);
                    },
                    title: "Rename folder",
                  });
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
              width={`${String(readPref(PREFS.panelWidth))}px`}
              onWidthCommitted={(px) => {
                writePref(PREFS.panelWidth, px);
              }}
            >
              <SidebarInset className="relative bg-surface">
                {openItem === null ? (
                  <LibraryView
                    scope={scope}
                    title={scopeTitle(scope, folders)}
                    listing={{
                      failure: listing.error,
                      more: () => {
                        if (listing.hasNextPage && !listing.isFetchingNextPage) {
                          void listing.fetchNextPage();
                        }
                      },
                      paused: listing.fetchStatus === "paused",
                      view,
                    }}
                    kind={kind}
                    onKindChange={setKind}
                    sort={sort}
                    onSortChange={setSort}
                    selection={selection}
                    actions={actions}
                    add={{
                      addFiles: () => {
                        filesRef.current?.click();
                      },
                      newFolder: () => {
                        setNameRequest({
                          confirm: "Create",
                          initial: "",
                          label: "Folder name",
                          onSubmit: (name) => {
                            verbs.createFolder(name, saveFolderOf(scope));
                          },
                          title: "New folder",
                        });
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
                      setNote(opened);
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
                  threadId={threadId}
                  onThread={chooseThread}
                  tidying={tidying}
                  onTidyEnd={() => {
                    setTidying(false);
                  }}
                  passage={passage}
                  onPassageTaken={() => {
                    setPassage(null);
                  }}
                  viewContext={viewContext}
                  flushOpen={async () => {
                    if (noteRef.current !== null) {
                      await noteHolds(noteRef.current);
                    }
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
          openHit: (itemId, query) => {
            findOnceOpen(itemId, query);
            if (itemId !== openItem) {
              open(itemId);
            }
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
      <MoveDialog
        request={moveRequest}
        folders={folders}
        onClose={() => {
          setMoveRequest(null);
        }}
      />
      <TagDialog
        request={tagRequest}
        onClose={() => {
          setTagRequest(null);
        }}
      />
      <NameDialog
        request={nameRequest}
        onClose={() => {
          setNameRequest(null);
        }}
      />
    </>
  );
};
