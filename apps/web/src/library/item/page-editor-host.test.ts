import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { getEditorHostActions, getEditorHostIo, libraryTitles } from "@repo/editor/host-io";
import { fileSha } from "@repo/contract/library/file-sha";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { onlineManager } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { ItemsMoved } from "@repo/client/library-cache";
import { libraryQueries } from "../cloud/library-queries";
import { createPageQueryClient } from "../cloud/v1";
import type { LibraryGoes } from "../library-place";
import { createWorkspaceStore } from "../workspace-store";
import { installPageEditorHost } from "./page-editor-host";

const PLANS = "0199a4c2-0000-7000-8000-0000000000c1";
const GONE = "0199a4c2-0000-7000-8000-0000000000c2";
const ORIGIN = "https://library.test";

const paragraph = { children: [{ text: "Held by the cell." }], id: "p1", type: "p" };

const cell = createFakeCell();
const { client } = cell.device("page");
const wire = { client, orpc: createTanstackQueryUtils(client) };

const nothing = (): void => {
  // the suite's socket and session have nothing to stop
};

// the host over the cell alone: no layout, workspace or panel is mounted, and the tab is where
// `openItem` says
const install = (
  upload: (request: Request) => Promise<Response>,
  openItem: string | null = null,
) => {
  const listeners: ((moved: ItemsMoved) => void)[] = [];
  const queryClient = createPageQueryClient();
  const workspace = createWorkspaceStore();
  const goes = {
    now: () => ({ kind: null, openItem, scope: { kind: "all" } }),
    openItem: vi.fn<LibraryGoes["openItem"]>(),
    showScope: vi.fn<LibraryGoes["showScope"]>(),
  } satisfies Pick<LibraryGoes, "now" | "openItem" | "showScope">;
  installPageEditorHost({
    cloud: { fetch: upload, onSessionEnd: nothing, origin: ORIGIN },
    goes,
    queryClient,
    socket: {
      onItems: (listener) => {
        listeners.push(listener);
        return nothing;
      },
    },
    wire,
    workspace,
  });
  return {
    goes,
    moved: (moved: ItemsMoved) => {
      for (const listener of listeners) {
        listener(moved);
      }
    },
    queryClient,
    workspace,
  };
};

const refused = async (): Promise<Response> =>
  await Promise.resolve(new Response(null, { status: 500 }));

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
    const sent: string[] = [];
    install(async (request) => {
      sent.push(`${request.method} ${request.url}`);
      return await Promise.resolve(new Response(null, { status: 201 }));
    });

    await expect(getEditorHostIo().keepFile(bytes, "image/png")).resolves.toStrictEqual({
      sha: fileSha(bytes),
    });
    expect(sent).toStrictEqual([`PUT ${ORIGIN}/v1/blobs/${fileSha(bytes)}`]);
  });

  it("dials a note on the cloud's origin with the account socket's ticket, and is offline the moment the browser says so", async () => {
    install(refused);
    const { notes } = getEditorHostIo();
    let heard = 0;
    const stop = notes.reach.subscribe(() => {
      heard += 1;
    });

    expect(notes.socketOrigin).toBe(ORIGIN);
    await expect(notes.socketTicket()).resolves.toBe("a-ticket");
    expect(notes.reach.get()).toBe(true);
    onlineManager.setOnline(false);
    expect(notes.reach.get()).toBe(false);
    onlineManager.setOnline(true);
    stop();
    expect(heard).toBe(2);
  });

  it("tells the editor which items the account's socket says moved", () => {
    const { moved } = install(refused);
    const heard: (ReadonlySet<string> | null)[] = [];
    getEditorHostIo().onItemsChanged((ids) => {
      heard.push(ids);
    });

    moved(new Set([PLANS]));
    moved(null);

    expect(heard).toStrictEqual([new Set([PLANS]), null]);
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
