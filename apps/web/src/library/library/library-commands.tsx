// What a press does to the library: every verb a menu row, a button, a chord or the palette asks
// for is one function here, which asks or confirms first where it must (`./ask.ts`), runs its verb
// (`./library-verbs.ts`) and goes where it leads (`../library-place.ts`). Made once under the
// library's layout and read by context, so a screen calls a command and is handed none. A press
// waits for nothing: each run says its own outcome.

import { saveFolderOf } from "@repo/client/library-labels";
import { isWebUrl } from "@repo/contract/items/item-url";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { usePageLibrary } from "../cloud/library-context";
import type { SaveInto } from "../cloud/library-writes";
import type { CloudWire } from "../cloud/v1";
import { libraryGoes, shownScope } from "../library-place";
import type { LibraryGoes } from "../library-place";
import type { WorkspaceStore } from "../workspace-store";
import { askFolder, askName, askTags } from "./ask";
import type { CapturePayload } from "./capture/capture-payload";
import { targetCount } from "./library-selection";
import type { Target } from "./library-selection";
import { useLibraryVerbs } from "./library-verbs";
import type { LibraryVerbs } from "./library-verbs";
import { saveTagsOf } from "./listing";

// a bulk delete this large asks first; any fewer go at once, each recoverable from Deleted
const DELETE_ASKS_OVER = 50;

interface CommandPorts {
  readonly goes: LibraryGoes;
  readonly verbs: LibraryVerbs;
  readonly workspace: Pick<WorkspaceStore, "compose" | "revealPanel" | "setPaletteOpen">;
  // the rail's scopes as the page last read them, which say whether an addressed folder is listed
  readonly queryClient: Pick<QueryClient, "getQueryData">;
  readonly wire: Pick<CloudWire, "orpc">;
}

const FOLDER_NAME = { initial: "", label: "Folder name" };

// a press starts its flow and waits for nothing
const press =
  <Args extends unknown[]>(flow: (...args: Args) => Promise<void>) =>
  (...args: Args): void => {
    void flow(...args);
  };

export const libraryCommands = ({ goes, queryClient, verbs, wire, workspace }: CommandPorts) => {
  // where a save lands: the folder and the tag the grid shows now
  const into = (): SaveInto => {
    const listed = queryClient.getQueryData(wire.orpc.library.listing.scopes.queryKey());
    const scope = shownScope(goes.now().scope, listed);
    return { folderId: saveFolderOf(scope), tags: saveTagsOf(scope) };
  };

  const saveLink = (url: string): void => {
    void verbs.saveLinks([{ title: null, url }], into(), goes.openItem);
  };

  const purge = async (target: Target): Promise<void> => {
    const sure = await confirm({
      body: "Their text and files are gone for good. This can't be undone.",
      confirmLabel: "Delete forever",
      destructive: true,
      title: `Delete ${plural(targetCount(target), "item")} forever?`,
    });
    if (sure) {
      await verbs.purge(target);
    }
  };

  return {
    askAgent: (): void => {
      workspace.revealPanel("agent");
    },
    askSaveLink: press(async () => {
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
    }),
    closeItem: (): void => {
      goes.closeItem();
    },
    deleteFolder: press(async (folderId: string, name: string) => {
      const sure = await confirm({
        body: "Its items move to Unsorted.",
        confirmLabel: "Delete folder",
        destructive: true,
        title: `Delete the folder “${name}”?`,
      });
      if (sure) {
        verbs.deleteFolder(folderId);
      }
    }),
    // all of Deleted, as the rail counts it, whatever kind the grid is narrowed to
    emptyDeleted: press(async () => {
      const scopes = queryClient.getQueryData(wire.orpc.library.listing.scopes.queryKey());
      const count = scopes?.deleted ?? 0;
      if (count > 0) {
        await purge({ count, kind: "scope", swept: { except: [], scope: { kind: "deleted" } } });
      }
    }),
    move: press(async (target: Target) => {
      const picked = await askFolder({ count: targetCount(target) });
      if (picked !== null) {
        await verbs.move(target, picked.folderId);
      }
    }),
    newFolder: press(async (parentId: string | null) => {
      const name = await askName({ ...FOLDER_NAME, confirm: "Create", title: "New folder" });
      if (name !== null) {
        verbs.createFolder(name, parentId);
      }
    }),
    newNote: press(async () => {
      try {
        goes.openItem(await verbs.createNote(into()));
      } catch (error) {
        toast.error(refusalText(error, "The note couldn't be made."));
      }
    }),
    openItem: goes.openItem,
    openPalette: (): void => {
      workspace.setPaletteOpen(true);
    },
    openSettings: goes.openSettings,
    pin: press(verbs.pin),
    purge: press(purge),
    // a saved page read again by the cloud's fill
    refresh: verbs.refresh,
    // to Deleted; one this large asks first
    remove: press(async (target: Target) => {
      const count = targetCount(target);
      if (count > DELETE_ASKS_OVER) {
        const sure = await confirm({
          body: "They wait in Deleted, where you can restore them.",
          confirmLabel: "Delete",
          destructive: true,
          title: `Delete ${plural(count, "item")}?`,
        });
        if (!sure) {
          return;
        }
      }
      // deleted on the person's word, so its leave asks nothing
      const { openItem } = goes.now();
      if (openItem !== null && target.kind === "ids" && target.ids.includes(openItem)) {
        goes.closeItem({ unasked: true });
      }
      await verbs.remove(target);
    }),
    renameFolder: press(async (folderId: string, name: string) => {
      const next = await askName({
        ...FOLDER_NAME,
        confirm: "Rename",
        initial: name,
        title: "Rename folder",
      });
      if (next !== null) {
        verbs.renameFolder(folderId, next);
      }
    }),
    restore: press(verbs.restore),
    // what a paste, a drop or the file picker handed over: each file and each link saved where the
    // grid's scope saves, and what could not be taken said
    save: (payload: CapturePayload): void => {
      for (const sentence of payload.refused) {
        toast.error(sentence);
      }
      void verbs.saveLinks(payload.urls, into(), goes.openItem);
      void verbs.addFiles(payload.files, into());
    },
    saveLink,
    showKind: goes.showKind,
    showScope: goes.showScope,
    startTidy: (): void => {
      workspace.compose({ kind: "tidy" });
      workspace.revealPanel("agent");
    },
    // `carried`: the tags of each item of the target the screen read
    tag: press(async (target: Target, carried: readonly (readonly string[])[]) => {
      // the tags every one of them carries, which the ask offers to take off
      const [first = [], ...rest] = carried;
      const held = first.filter((tag) => rest.every((tags) => tags.includes(tag)));
      const change = await askTags({ count: targetCount(target), held });
      if (change !== null) {
        await verbs.tag(target, change);
      }
    }),
  };
};

export type LibraryCommands = ReturnType<typeof libraryCommands>;

export const LibraryCommandsContext = createContext<LibraryCommands | null>(null);

export const LibraryCommandsProvider = ({ children }: { children: ReactNode }) => {
  const { wire, workspace } = usePageLibrary();
  const router = useRouter();
  const queryClient = useQueryClient();
  const verbs = useLibraryVerbs();
  const commands = libraryCommands({
    goes: libraryGoes(router),
    queryClient,
    verbs,
    wire,
    workspace,
  });
  return <LibraryCommandsContext value={commands}>{children}</LibraryCommandsContext>;
};

export const useLibraryCommands = (): LibraryCommands => {
  const commands = useContext(LibraryCommandsContext);
  if (commands === null) {
    throw new Error("useLibraryCommands must be used inside LibraryCommandsProvider");
  }
  return commands;
};
