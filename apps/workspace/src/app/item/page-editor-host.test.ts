import { createORPCClient, createORPCErrorFromJson } from "@orpc/client";
import type { V1Client } from "@repo/contract/cloud/v1";
import { getEditorHostIo } from "@repo/editor/host-io";
import { fileSha } from "@repo/notes/library/file-sha";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ItemsMoved } from "../cloud/use-library-socket";
import { heldItem } from "../test-support/cell-rows";
import { installPageEditorHost } from "./page-editor-host";

const PLANS = "0199a4c2-0000-7000-8000-0000000000c1";
const GONE = "0199a4c2-0000-7000-8000-0000000000c2";
const ORIGIN = "https://library.test";

const paragraph = { children: [{ text: "Held by the cell." }], id: "p1", type: "p" };

const client = createORPCClient<V1Client>({
  call: async (path, input) => {
    if (path.join(".") !== "library.items.get") {
      throw new Error(`the suite answers no ${path.join(".")}`);
    }
    if (z.object({ id: z.string() }).parse(input).id === PLANS) {
      return await Promise.resolve({
        ...heldItem(PLANS, { title: "Plans" }),
        blocks: [{ block: paragraph, hash: "h1", ord: "a0", section: "note" }],
      });
    }
    throw createORPCErrorFromJson({
      code: "NOT_FOUND",
      data: undefined,
      defined: true,
      message: "No such item.",
    });
  },
});

const nothing = (): void => {
  // the suite's page has no item view, panel or composer to answer with
};

const install = (upload: (request: Request) => Promise<Response>) => {
  const listeners: ((moved: ItemsMoved) => void)[] = [];
  installPageEditorHost({
    askAgent: nothing,
    cloud: { fetch: upload, onSessionEnd: nothing, origin: ORIGIN },
    openItem: nothing,
    showTag: nothing,
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

  it("tells the editor which items the account's socket says moved", () => {
    const { moved } = install(refused);
    const heard: (ReadonlySet<string> | null)[] = [];
    getEditorHostIo().onItemsChanged((ids) => {
      heard.push(ids);
    });

    moved(new Map([[PLANS, 4]]));
    moved(null);

    expect(heard).toStrictEqual([new Set([PLANS]), null]);
  });
});
