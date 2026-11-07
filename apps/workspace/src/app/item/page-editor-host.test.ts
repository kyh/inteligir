import { getEditorHostIo } from "@repo/editor/host-io";
import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import type { FakeDevice } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, paragraph } from "@repo/library-replica/test-support/replica-harness";
import { describe, expect, it } from "vitest";

import { installPageEditorHost } from "./page-editor-host";

const BODIES = "/v1/rpc/library/sync/bodies";

// a device's network that holds its calls for the library's bodies until the case lets them go
const holdingBodies = (network: FakeDevice) => {
  const asked = Promise.withResolvers<null>();
  const gate = Promise.withResolvers<null>();
  const device: FakeDevice = {
    ...network,
    transport: {
      fetch: async (request) => {
        if (new URL(request.url).pathname === BODIES) {
          asked.resolve(null);
          await gate.promise;
        }
        return await network.transport.fetch(request);
      },
      origin: network.transport.origin,
    },
  };
  return {
    asked: asked.promise,
    device,
    release: () => {
      gate.resolve(null);
    },
  };
};

const nothing = (): void => {
  // the suite's page has no item view, panel or composer to answer with
};

describe("the page's editor host", () => {
  it("answers an embedded item's blocks only once this page holds its body", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const { id } = await mac.replica.createNote({
      blocks: [{ block: paragraph("p1", "Pulled at last."), ord: "a0", section: "note" }],
      folderId: null,
      tags: [],
      title: "Plans",
    });
    await mac.replica.sync();
    const held = holdingBodies(cell.device("tab"));
    const tab = await openDevice(cell, "tab", { network: held.device });
    installPageEditorHost({
      askAgent: nothing,
      openAnnotations: nothing,
      openItem: nothing,
      readFile: async () => await Promise.reject(new Error("the suite draws no file")),
      replica: tab.replica,
      showTag: nothing,
    });

    const syncing = tab.replica.sync();
    await held.asked;
    await expect(tab.replica.item(id)).resolves.toMatchObject({ bodyHeld: false, blocks: [] });
    await expect(getEditorHostIo().readItemBlocks(id)).resolves.toBeNull();

    held.release();
    await syncing;
    await expect(getEditorHostIo().readItemBlocks(id)).resolves.toStrictEqual([
      paragraph("p1", "Pulled at last."),
    ]);
  });
});
