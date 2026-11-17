import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { describe, expect, it, vi } from "vitest";

import { libraryQueries } from "../cloud/library-queries";
import { createPageQueryClient } from "../cloud/v1";
import type { LibraryGoes } from "../library-place";
import { createWorkspaceStore } from "../workspace-store";
import { asks } from "./ask";
import { libraryCommands } from "./library-commands";
import type { Target } from "./library-selection";
import type { LibraryVerbs } from "./library-verbs";

const NOTE = "0199a4c2-0000-7000-8000-0000000000d1";

const idsOf = (...ids: string[]): Target => ({ ids, kind: "ids" });

const spyVerbs = () =>
  ({
    addFiles: vi.fn<LibraryVerbs["addFiles"]>(),
    createFolder: vi.fn<LibraryVerbs["createFolder"]>(),
    createNote: vi.fn<LibraryVerbs["createNote"]>(async () => await Promise.resolve(NOTE)),
    deleteFolder: vi.fn<LibraryVerbs["deleteFolder"]>(),
    move: vi.fn<LibraryVerbs["move"]>(),
    pin: vi.fn<LibraryVerbs["pin"]>(),
    purge: vi.fn<LibraryVerbs["purge"]>(),
    refresh: vi.fn<LibraryVerbs["refresh"]>(),
    remove: vi.fn<LibraryVerbs["remove"]>(),
    renameFolder: vi.fn<LibraryVerbs["renameFolder"]>(),
    restore: vi.fn<LibraryVerbs["restore"]>(),
    saveLinks: vi.fn<LibraryVerbs["saveLinks"]>(),
    tag: vi.fn<LibraryVerbs["tag"]>(),
  }) satisfies LibraryVerbs;

// the commands over spies for the cell's verbs and the router, with no layout, host or screen: the
// tab is at `place`, and the rail's scopes are as the cell lists them
const commandsAt = async (
  place: Partial<ReturnType<LibraryGoes["now"]>> = {},
  cell = createFakeCell(),
) => {
  const { client } = cell.device("page");
  const wire = { client, orpc: createTanstackQueryUtils(client) };
  const queryClient = createPageQueryClient();
  await queryClient.query(libraryQueries(wire).scopes());
  const goes = {
    closeItem: vi.fn<LibraryGoes["closeItem"]>(),
    now: () => ({ kind: null, openItem: null, scope: { kind: "all" }, ...place }),
    openItem: vi.fn<LibraryGoes["openItem"]>(),
    openSettings: vi.fn<LibraryGoes["openSettings"]>(),
    showKind: vi.fn<LibraryGoes["showKind"]>(),
    showScope: vi.fn<LibraryGoes["showScope"]>(),
  } satisfies LibraryGoes;
  const verbs = spyVerbs();
  const workspace = createWorkspaceStore();
  return {
    commands: libraryCommands({ goes, queryClient, verbs, wire, workspace }),
    goes,
    verbs,
    workspace,
  };
};

// the ask a command stands on, which the suite answers as the host's form would
const folderAsk = () => {
  const ask = asks.getState().standing;
  if (ask?.kind !== "folder") {
    throw new Error("no ask for a folder stands");
  }
  return ask;
};

const tagsAsk = () => {
  const ask = asks.getState().standing;
  if (ask?.kind !== "tags") {
    throw new Error("no ask for a tag change stands");
  }
  return ask;
};

describe("a command", () => {
  it("asks for a folder before a move, and moves nothing once the ask is let go", async () => {
    const { commands, verbs } = await commandsAt();

    commands.move(idsOf("a", "b"));
    expect(folderAsk().count).toBe(2);
    folderAsk().answer({ folderId: "f1" });
    await vi.waitFor(() => {
      expect(verbs.move).toHaveBeenCalledExactlyOnceWith(idsOf("a", "b"), "f1");
    });

    commands.move(idsOf("a"));
    folderAsk().answer(null);
    await Promise.resolve();
    expect(verbs.move).toHaveBeenCalledOnce();
  });

  it("offers to take off only the tags every subject read carries, counting a scope past them", async () => {
    const { commands, verbs } = await commandsAt();
    const scope: Target = {
      count: 8512,
      kind: "scope",
      swept: { except: [], scope: { kind: "all" } },
    };

    commands.tag(scope, [["field", "spring"], ["spring"]]);
    expect(tagsAsk()).toMatchObject({ count: 8512, held: ["spring"] });
    tagsAsk().answer({ add: [], remove: ["spring"] });

    await vi.waitFor(() => {
      expect(verbs.tag).toHaveBeenCalledExactlyOnceWith(scope, { add: [], remove: ["spring"] });
    });
  });

  it("makes a note where the shown scope saves and opens it: a listed folder's, a tag's, or none for a folder the library no longer lists", async () => {
    const cell = createFakeCell();
    const folderId = cell.seed.folder("Reading");
    const inFolder = await commandsAt({ scope: { folderId, kind: "folder" } }, cell);
    const underTag = await commandsAt({ scope: { kind: "tag", tag: "field" } }, cell);
    const gone = await commandsAt(
      { scope: { folderId: "deleted-elsewhere", kind: "folder" } },
      cell,
    );

    inFolder.commands.newNote();
    underTag.commands.newNote();
    gone.commands.newNote();

    await vi.waitFor(() => {
      expect(inFolder.goes.openItem).toHaveBeenCalledExactlyOnceWith(NOTE);
    });
    expect(inFolder.verbs.createNote).toHaveBeenCalledWith({ folderId, tags: [] });
    expect(underTag.verbs.createNote).toHaveBeenCalledWith({ folderId: null, tags: ["field"] });
    expect(gone.verbs.createNote).toHaveBeenCalledWith({ folderId: null, tags: [] });
  });

  it("leaves the open item unasked when it is among what a delete takes", async () => {
    const { commands, goes, verbs } = await commandsAt({ openItem: NOTE });

    commands.remove(idsOf(NOTE));

    await vi.waitFor(() => {
      expect(verbs.remove).toHaveBeenCalledExactlyOnceWith(idsOf(NOTE));
    });
    expect(goes.closeItem).toHaveBeenCalledExactlyOnceWith({ unasked: true });
  });

  it("opens the panel on the agent with a Tidy's request waiting", async () => {
    const { commands, workspace } = await commandsAt();

    commands.startTidy();

    const { composer, panelTab } = workspace.store.getState();
    expect(composer.target).toStrictEqual({ kind: "tidying" });
    expect(panelTab).toBe("agent");
  });
});
