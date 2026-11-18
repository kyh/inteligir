import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { getEditorHostActions, getEditorHostIo, libraryTitles } from "@repo/editor/host-io";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { deferred } from "@repo/contract/deferred";
import type { Deferred } from "@repo/contract/deferred";
import { fileSha } from "@repo/contract/library/file-sha";
import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import { onlineManager } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { libraryQueries } from "../cloud/library-queries";
import { createPageQueryClient } from "../cloud/v1";
import type { LibraryGoes } from "../library-history";
import { createWorkspaceStore } from "../workspace-store";
import { installPageEditorHost } from "./page-editor-host";

const PLANS = "0199a4c2-0000-7000-8000-0000000000c1";
const GONE = "0199a4c2-0000-7000-8000-0000000000c2";
const ORIGIN = "https://library.test";

const paragraph = { children: [{ text: "Held by the cell." }], id: "p1", type: "p" };

const cell = createFakeCell();
const page = cell.device("page");
const { client } = page;

const wire = {
  client,
  orpc: createTanstackQueryUtils(client),
  outliving: cell.device("outliving").client,
};

const nothing = () => {};

const held = (text: string) =>
  [{ block: { children: [{ text }], id: "p1", type: "p" }, section: "note" }] satisfies BodyBlock[];

const install = (
  upload: (request: Request) => Promise<Response>,
  openItem: string | null = null,
) => {
  const queryClient = createPageQueryClient();
  const workspace = createWorkspaceStore();

  const goes = {
    now: () => ({ find: null, kind: null, openItem, scope: { kind: "all" }, settings: false }),
    openItem: vi.fn<LibraryGoes["openItem"]>(),
    showScope: vi.fn<LibraryGoes["showScope"]>(),
  } satisfies Pick<LibraryGoes, "now" | "openItem" | "showScope">;

  installPageEditorHost({
    cloud: { fetch: upload, onSessionEnd: nothing, origin: ORIGIN },
    goes,
    queryClient,
    wire,
    workspace,
  });

  return { goes, queryClient, workspace };
};

const refused = async () => await Promise.resolve(new Response(null, { status: 500 }));

interface Standing {
  readonly version: number;
  readonly deleted: boolean;
}

const followed = () => {
  let last: Standing | null = null;
  const waits: { readonly want: Standing; readonly heard: Deferred<void> }[] = [];
  const same = (a: Standing, b: Standing) => a.version === b.version && a.deleted === b.deleted;

  return {
    heard: (standing: Standing) => {
      last = standing;

      for (const wait of waits) {
        if (same(standing, wait.want)) {
          wait.heard.resolve();
        }
      }
    },
    reaches: async (want: Standing) => {
      const heard = deferred();
      waits.push({ heard, want });

      if (last !== null && same(last, want)) {
        heard.resolve();
      }

      await heard.promise;
    },
  };
};

describe("the page's editor host", () => {
  it("answers an embedded item's blocks as the cell holds them, and none for an item it lacks", async () => {
    await client.library.items.create({
      blocks: [{ block: paragraph, section: "note" }],
      folderId: null,
      id: PLANS,
      savedAt: 1_700_000_000_000,
      tags: [],
      title: "Plans",
    });
    install(refused);

    await expect(getEditorHostIo().readItemBlocks(PLANS)).resolves.toStrictEqual([paragraph]);
    await expect(getEditorHostIo().readItemBlocks(GONE)).resolves.toBeNull();
  });

  it("keeps a pasted file by sending it up first, and answers the sha it went under", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    install(cell.device("paste").transport.fetch);

    await expect(getEditorHostIo().keepFile(bytes, "image/png")).resolves.toStrictEqual({
      sha: fileSha(bytes),
    });
    expect(cell.uploads).toStrictEqual([fileSha(bytes)]);
  });

  it("reads a note whole, and saves it over the version it read, a small save sent to outlive the page", async () => {
    const id = cell.seed.item({ title: "Minutes" }, held("Read here."));
    install(refused);
    const { notes } = getEditorHostIo();

    await expect(notes.read(id)).resolves.toStrictEqual({
      blocks: held("Read here."),
      deleted: false,
      title: "Minutes",
      version: 1,
    });
    await expect(notes.read(GONE)).resolves.toBeNull();
    await expect(
      notes.save({ baseVersion: 1, blocks: held("Typed here."), id }, false),
    ).resolves.toStrictEqual({ kind: "saved", version: 2 });
    await expect(
      notes.save({ baseVersion: 1, blocks: held("Typed elsewhere."), id }, true),
    ).resolves.toStrictEqual({ kind: "stale" });
    await expect(
      notes.save({ baseVersion: 1, blocks: held("Typed here."), id: GONE }, false),
    ).resolves.toStrictEqual({ kind: "missing" });
    expect(cell.calls.filter((call) => call.endsWith("library/items/saveBody"))).toStrictEqual([
      "page library/items/saveBody",
      "outliving library/items/saveBody",
      "page library/items/saveBody",
    ]);
  });

  it("reads a note as this tab last read it while the cloud can't be reached, and nothing it never read", async () => {
    const id = cell.seed.item({ title: "Minutes" }, held("Read before."));
    const unread = cell.seed.item({ title: "Never opened" });
    install(refused);
    const { notes } = getEditorHostIo();
    await notes.read(id);

    page.setOffline(true);

    try {
      await expect(notes.read(id)).resolves.toMatchObject({ blocks: held("Read before.") });
      await expect(notes.read(unread)).rejects.toThrow();
    } finally {
      page.setOffline(false);
    }
  });

  it("follows a note's version and Deleted by its row, as the library's changes read it again", async () => {
    const id = cell.seed.item({ title: "Minutes" }, held("One."));
    const { queryClient } = install(refused);
    const { notes } = getEditorHostIo();
    const standing = followed();
    const stop = notes.follow(id, standing.heard);

    await standing.reaches({ deleted: false, version: 1 });
    await client.library.items.saveBody({ baseVersion: 1, blocks: held("Two."), id });
    await client.library.items.delete({ ids: [id] });
    await queryClient.invalidateQueries({ queryKey: libraryQueries(wire).item(id).queryKey });
    await standing.reaches({ deleted: true, version: 2 });
    stop();
  });

  it("is offline the moment the browser says so", () => {
    install(refused);
    const { notes } = getEditorHostIo();
    let heard = 0;

    const stop = notes.reach.subscribe(() => {
      heard += 1;
    });

    expect(notes.reach.get()).toBe(true);
    onlineManager.setOnline(false);
    expect(notes.reach.get()).toBe(false);
    onlineManager.setOnline(true);
    stop();
    expect(heard).toBe(2);
  });

  it("opens the item a link names and shows the grid of a tag a note names", () => {
    const { goes } = install(refused);

    getEditorHostIo().openItem(PLANS);
    getEditorHostActions().agent.showTag("field");

    expect(goes.openItem).toHaveBeenCalledExactlyOnceWith(PLANS);
    expect(goes.showScope).toHaveBeenCalledExactlyOnceWith({ kind: "tag", tag: "field" });
  });

  it("quotes a passage asked about in the tab's composer, on the panel's Agent tab", () => {
    const { workspace } = install(refused);

    getEditorHostActions().agent.askAboutSelection("the passage");

    const { composer, panelTab } = workspace.store.getState();
    expect(composer.text).toBe("> the passage\n\n");
    expect(panelTab).toBe("agent");
  });

  it("makes a note in the folder of the item open now, as its view read it", async () => {
    const folderId = cell.seed.folder("Reading");
    const article = cell.seed.item({ folderId, title: "An article" });
    const { queryClient } = install(refused, article);
    await queryClient.query(libraryQueries(wire).item(article));

    const id = await getEditorHostActions().items.createNote({ blocks: [], title: "Cut" });

    expect(cell.item(id)?.fields).toMatchObject({ folderId, title: "Cut" });
  });

  it("hands the editor the library's titles as the page's query of them answers", async () => {
    const id = cell.seed.item({ title: "Quarterly plan" });
    install(refused);

    await vi.waitFor(() => {
      expect(libraryTitles.getState().byId.get(id)).toBe("Quarterly plan");
    });
  });
});
