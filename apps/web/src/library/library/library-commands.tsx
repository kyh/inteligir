import type { ContainerKind } from "@repo/contract/items/item-kind";
import { saveFolderOf } from "@repo/client/library-labels";
import { isWebUrl } from "@repo/contract/items/item-url";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { usePageLibrary } from "../cloud/library-context";
import type { SaveInto } from "../cloud/library-writes";
import type { CloudWire } from "../cloud/v1";
import { shownScope } from "../library-address";
import { libraryGoes } from "../library-history";
import type { LibraryGoes } from "../library-history";
import type { WorkspaceStore } from "../workspace-store";
import { askFolder, askName, askTags } from "./ask";
import type { CapturePayload } from "./capture/capture-payload";
import { targetCount } from "./library-selection";
import type { Target } from "./library-selection";
import { useLibraryVerbs } from "./library-verbs";
import type { LibraryVerbs } from "./library-verbs";
import { saveTagsOf } from "./listing";

const DELETE_ASKS_OVER = 50;

interface CommandPorts {
  readonly goes: Pick<
    LibraryGoes,
    "closeItem" | "now" | "openItem" | "openSettings" | "showKind" | "showScope"
  >;
  readonly verbs: LibraryVerbs;
  readonly workspace: Pick<WorkspaceStore, "compose" | "revealPanel" | "setPaletteOpen">;
  readonly queryClient: Pick<QueryClient, "getQueryData">;
  readonly wire: Pick<CloudWire, "orpc">;
}

const FOLDER_NAME = { initial: "", label: "Folder name" };

const LIST_NAME = { initial: "", label: "List name" };

const press =
  <Args extends unknown[]>(flow: (...args: Args) => Promise<void>) =>
  (...args: Args) => {
    void flow(...args);
  };

export const libraryCommands = ({ goes, queryClient, verbs, wire, workspace }: CommandPorts) => {
  const into = () => {
    const listed = queryClient.getQueryData(wire.orpc.library.listing.scopes.queryKey());
    const scope = shownScope(goes.now().scope, listed);

    return { parentId: saveFolderOf(scope), tags: saveTagsOf(scope) } satisfies SaveInto;
  };

  const saveLink = (url: string) => {
    void verbs.saveLinks([{ title: null, url }], into(), goes.openItem);
  };

  const purge = async (target: Target) => {
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
    askAgent: () => {
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
    closeItem: () => {
      goes.closeItem();
    },
    deleteFolder: press(async (parentId: string, name: string, kind: ContainerKind = "folder") => {
      const sure = await confirm({
        body: "Its items move to Unsorted.",
        confirmLabel: kind === "list" ? "Delete list" : "Delete folder",
        destructive: true,
        title: `Delete the ${kind} “${name}”?`,
      });

      if (sure) {
        verbs.deleteFolder(parentId);
      }
    }),
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
        await verbs.move(target, picked.parentId);
      }
    }),
    newFolder: press(async (parentId: string | null) => {
      const name = await askName({ ...FOLDER_NAME, confirm: "Create", title: "New folder" });

      if (name !== null) {
        verbs.createFolder(name, parentId);
      }
    }),
    newList: press(async (parentId: string | null) => {
      const name = await askName({ ...LIST_NAME, confirm: "Create", title: "New list" });

      if (name !== null) {
        verbs.createFolder(name, parentId, "list");
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
    openPalette: () => {
      workspace.setPaletteOpen(true);
    },
    openSettings: goes.openSettings,
    pin: press(verbs.pin),
    purge: press(purge),
    refresh: verbs.refresh,
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

      const { openItem } = goes.now();

      if (openItem !== null && target.kind === "ids" && target.ids.includes(openItem)) {
        goes.closeItem({ unasked: true });
      }

      await verbs.remove(target);
    }),
    renameFolder: press(async (parentId: string, name: string, kind: ContainerKind = "folder") => {
      const next = await askName({
        ...(kind === "list" ? LIST_NAME : FOLDER_NAME),
        confirm: "Rename",
        initial: name,
        title: kind === "list" ? "Rename list" : "Rename folder",
      });

      if (next !== null) {
        verbs.renameFolder(parentId, next);
      }
    }),
    restore: press(verbs.restore),
    save: (payload: CapturePayload) => {
      for (const sentence of payload.refused) {
        toast.error(sentence);
      }

      void verbs.saveLinks(payload.urls, into(), goes.openItem);
      void verbs.addFiles(payload.files, into());
    },
    saveLink,
    showKind: goes.showKind,
    showScope: goes.showScope,
    startTidy: () => {
      workspace.compose({ kind: "tidy" });
      workspace.revealPanel("agent");
    },
    tag: press(async (target: Target, carried: readonly (readonly string[])[]) => {
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
  const queryClient = useQueryClient();
  const verbs = useLibraryVerbs();

  const commands = libraryCommands({
    goes: libraryGoes,
    queryClient,
    verbs,
    wire,
    workspace,
  });

  return <LibraryCommandsContext value={commands}>{children}</LibraryCommandsContext>;
};

export const useLibraryCommands = () => {
  const commands = useContext(LibraryCommandsContext);

  if (commands === null) {
    throw new Error("useLibraryCommands must be used inside LibraryCommandsProvider");
  }

  return commands;
};
