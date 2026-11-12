import { getEditorHostIo } from "@repo/editor/host-io";
import { fileSha } from "@repo/contract/library/file-sha";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { onlineManager } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { ItemsMoved } from "@repo/client/library-cache";
import { installPageEditorHost } from "./page-editor-host";

const PLANS = "0199a4c2-0000-7000-8000-0000000000c1";
const GONE = "0199a4c2-0000-7000-8000-0000000000c2";
const ORIGIN = "https://library.test";

const paragraph = { children: [{ text: "Held by the cell." }], id: "p1", type: "p" };

const { client } = createFakeCell().device("page");

const nothing = (): void => {
  // the suite's page has no item view, panel or composer to answer with
};

const install = (upload: (request: Request) => Promise<Response>) => {
  const listeners: ((moved: ItemsMoved) => void)[] = [];
  installPageEditorHost({
    cloud: { fetch: upload, onSessionEnd: nothing, origin: ORIGIN },
    socket: {
      onItems: (listener) => {
        listeners.push(listener);
        return nothing;
      },
    },
    wire: { client },
  });
  return {
    moved: (moved: ItemsMoved) => {
      for (const listener of listeners) {
        listener(moved);
      }
    },
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
    const stop = notes.onOfflineChange(() => {
      heard += 1;
    });

    expect(notes.socketOrigin).toBe(ORIGIN);
    await expect(notes.socketTicket()).resolves.toBe("a-ticket");
    expect(notes.notePath(PLANS)).toBe(`/v1/notes/${PLANS}`);
    expect(notes.offline()).toBe(false);
    onlineManager.setOnline(false);
    expect(notes.offline()).toBe(true);
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
});
