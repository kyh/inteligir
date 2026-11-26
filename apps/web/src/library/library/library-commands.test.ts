import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { deferred } from "@repo/contract/deferred";
import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import { describe, expect, it, vi } from "vitest";

import { libraryQueries } from "../cloud/library-queries";
import { createPageQueryClient } from "../cloud/v1";
import type { LibraryGoes } from "../library-history";
import { createWorkspaceStore } from "../workspace-store";
import { asks } from "./ask";
import { libraryCommands } from "./library-commands";
import type { Target } from "./library-selection";
import type { LibraryVerbs } from "./library-verbs";

const NOTE = "0199a4c2-0000-7000-8000-0000000000d1";

const idsOf = (...ids: string[]) => ({ ids, kind: "ids" }) satisfies Target;

const spyVerbs = () => {
  const heard = { move: deferred(), remove: deferred(), tag: deferred() };

  const verbs = {
    addFiles: vi.fn<LibraryVerbs["addFiles"]>(),
    createFolder: vi.fn<LibraryVerbs["createFolder"]>(),
    createNote: async () => await Promise.resolve(NOTE),
    deleteFolder: vi.fn<LibraryVerbs["deleteFolder"]>(),
    move: async () => {
      heard.move.resolve();
      await Promise.resolve();
    },
    pin: vi.fn<LibraryVerbs["pin"]>(),
    purge: vi.fn<LibraryVerbs["purge"]>(),
    refresh: vi.fn<LibraryVerbs["refresh"]>(),
    remove: async () => {
      heard.remove.resolve();
      await Promise.resolve();
    },
    renameFolder: vi.fn<LibraryVerbs["renameFolder"]>(),
    restore: vi.fn<LibraryVerbs["restore"]>(),
    removeView: vi.fn<LibraryVerbs["removeView"]>(),
    saveLinks: vi.fn<LibraryVerbs["saveLinks"]>(),
    saveView: vi.fn<LibraryVerbs["saveView"]>(),
    tag: async () => {
      heard.tag.resolve();
      await Promise.resolve();
    },
  } satisfies LibraryVerbs;

  vi.spyOn(verbs, "createNote");
  vi.spyOn(verbs, "move");
  vi.spyOn(verbs, "remove");
  vi.spyOn(verbs, "tag");

  return { heard, verbs };
};

const commandsAt = async (
  place: Partial<ReturnType<LibraryGoes["now"]>> = {},
  cell = createFakeCell(),
) => {
  const { client } = cell.device("page");
  const wire = { client, orpc: createTanstackQueryUtils(client), outliving: client };
  const queryClient = createPageQueryClient();
  await queryClient.query(libraryQueries(wire).scopes());

  const opened = deferred();

  const goes = {
    closeItem: vi.fn<LibraryGoes["closeItem"]>(),
    now: () => ({
      find: null,
      kind: null,
      openItem: null,
      scope: { kind: "all" },
      settings: false,
      words: null,
      ...place,
    }),
    openItem: () => {
      opened.resolve();
    },
    openSettings: vi.fn<LibraryGoes["openSettings"]>(),
    showKind: vi.fn<LibraryGoes["showKind"]>(),
    showScope: vi.fn<LibraryGoes["showScope"]>(),
    showView: vi.fn<LibraryGoes["showView"]>(),
    showWords: vi.fn<LibraryGoes["showWords"]>(),
  } satisfies Parameters<typeof libraryCommands>[0]["goes"];

  vi.spyOn(goes, "openItem");
  const { heard, verbs } = spyVerbs();
  const workspace = createWorkspaceStore();

  return {
    commands: libraryCommands({ goes, queryClient, verbs, wire, workspace }),
    goes,
    heard: { ...heard, openItem: opened },
    verbs,
    workspace,
  };
};

const folderAsk = () => {
  const ask = asks.getState().standing;

  if (ask?.kind !== "parent") {
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
    const { commands, heard, verbs } = await commandsAt();

    commands.move(idsOf("a", "b"));
    expect(folderAsk().count).toBe(2);
    folderAsk().answer({ parentId: "f1" });
    await heard.move.promise;
    expect(verbs.move).toHaveBeenCalledExactlyOnceWith(idsOf("a", "b"), "f1");

    commands.move(idsOf("a"));
    folderAsk().answer(null);
    await Promise.resolve();
    expect(verbs.move).toHaveBeenCalledOnce();
  });

  it("offers to take off only the tags every subject read carries, counting a scope past them", async () => {
    const { commands, heard, verbs } = await commandsAt();

    const scope: Target = {
      count: 8512,
      kind: "scope",
      swept: { except: [], scope: { kind: "all" } },
    };

    commands.tag(scope, [["field", "spring"], ["spring"]]);
    expect(tagsAsk()).toMatchObject({ count: 8512, held: ["spring"] });
    tagsAsk().answer({ add: [], remove: ["spring"] });

    await heard.tag.promise;
    expect(verbs.tag).toHaveBeenCalledExactlyOnceWith(scope, { add: [], remove: ["spring"] });
  });

  it("makes a note where the shown scope saves and opens it: a listed folder's, a tag's, or none for a folder the library no longer lists", async () => {
    const cell = createFakeCell();
    const parentId = cell.seed.folder("Reading");
    const inFolder = await commandsAt({ scope: { parentId, kind: "parent" } }, cell);
    const underTag = await commandsAt({ scope: { kind: "tag", tag: "field" } }, cell);

    const gone = await commandsAt(
      { scope: { parentId: "deleted-elsewhere", kind: "parent" } },
      cell,
    );

    inFolder.commands.newNote();
    underTag.commands.newNote();
    gone.commands.newNote();

    await inFolder.heard.openItem.promise;
    expect(inFolder.goes.openItem).toHaveBeenCalledExactlyOnceWith(NOTE);
    expect(inFolder.verbs.createNote).toHaveBeenCalledWith({ parentId, tags: [] });
    expect(underTag.verbs.createNote).toHaveBeenCalledWith({ parentId: null, tags: ["field"] });
    expect(gone.verbs.createNote).toHaveBeenCalledWith({ parentId: null, tags: [] });
  });

  it("leaves the open item unasked when it is among what a delete takes", async () => {
    const { commands, goes, heard, verbs } = await commandsAt({ openItem: NOTE });

    commands.remove(idsOf(NOTE));

    await heard.remove.promise;
    expect(verbs.remove).toHaveBeenCalledExactlyOnceWith(idsOf(NOTE));
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
