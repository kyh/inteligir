import { uploadBlob, v1Client } from "@repo/contract/library/call-outcome";
import type { SessionEnd } from "@repo/contract/library/call-outcome";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell, FakeDevice } from "@repo/contract/test-support/fake-cell";
import { WEB_URL_RULE } from "@repo/contract/items/item-kind";
import { fileSha } from "@repo/contract/library/file-sha";
import { describe, expect, it } from "vitest";

import { memoryKv } from "../test-support/memory-kv";
import type { MemoryKv } from "../test-support/memory-kv";
import { createPhoneSaves } from "./phone-saves";
import { createShareOutbox } from "./share-outbox";

const PAGE = "https://example.com/later";

// a fresh UUIDv7 each time, as the phone mints its ids
const idSource = () => {
  let next = 0;
  return (): string => {
    next += 1;
    return `0190a000-0000-7000-8000-${next.toString(16).padStart(12, "0")}`;
  };
};

const phoneOver = (device: FakeDevice, storage: MemoryKv = memoryKv()) => {
  const ended: SessionEnd[] = [];
  let landings = 0;
  const saves = createPhoneSaves({
    client: v1Client(device.transport, (end) => {
      ended.push(end);
    }),
    files: {
      keep: async () => {
        await Promise.resolve();
      },
    },
    newBlockId: idSource(),
    newId: idSource(),
    now: () => 1_700_000_000_000,
    sha256Hex: async (bytes) => await Promise.resolve(fileSha(bytes)),
    upload: async (file) => await uploadBlob(device.transport, file),
  });
  const shares = createShareOutbox({
    landed: () => {
      landings += 1;
    },
    saves,
    storage,
  });
  return { ended, landings: () => landings, shares, storage };
};

const itemsAt = (cell: FakeCell, url: string) =>
  [...cell.items().values()].filter((item) => item.fields.url === url);

describe("the shares this phone keeps until the cloud takes them", () => {
  it("keeps a share before it is sent, so one made offline waits", async () => {
    const cell = createFakeCell();
    const device = cell.device("phone");
    const { shares, storage } = phoneOver(device);
    device.setOffline(true);

    const kept = await shares.keep({ kind: "link", note: "For Tuesday.", title: null, url: PAGE });
    if (kept === null) {
      throw new Error("the outbox refused a share while signed in");
    }
    expect(storage.held.has(`share:${kept.opId}`)).toBe(true);
    await expect(shares.deliver(kept.opId)).resolves.toStrictEqual({ kind: "waiting" });
    expect(shares.waiting.get()).toHaveLength(1);
    expect(cell.items().size).toBe(0);
  });

  it("still holds a waiting share after a relaunch, and lands it once the cloud can be reached", async () => {
    const cell = createFakeCell();
    const device = cell.device("phone");
    const first = phoneOver(device);
    device.setOffline(true);
    await first.shares.keep({ kind: "link", note: null, title: null, url: PAGE });
    await first.shares.flush();

    const relaunched = phoneOver(device, first.storage);
    await relaunched.shares.load();
    expect(relaunched.shares.waiting.get()).toHaveLength(1);
    device.setOffline(false);
    await relaunched.shares.flush();

    expect(itemsAt(cell, PAGE)).toHaveLength(1);
    expect(relaunched.shares.waiting.get()).toStrictEqual([]);
    expect([...relaunched.storage.held.keys()]).toStrictEqual([]);
    expect(relaunched.landings()).toBe(1);
  });

  it("lands a share once when the answer to its first send was lost", async () => {
    const cell = createFakeCell();
    const device = cell.device("phone");
    const { shares } = phoneOver(device);
    const kept = await shares.keep({ kind: "link", note: null, title: null, url: PAGE });
    if (kept === null) {
      throw new Error("the outbox refused a share while signed in");
    }
    device.loseAnswers(1);
    await expect(shares.deliver(kept.opId)).resolves.toStrictEqual({ kind: "waiting" });

    await expect(shares.deliver(kept.opId)).resolves.toStrictEqual({
      itemId: kept.id,
      kind: "landed",
    });
    expect(itemsAt(cell, PAGE)).toHaveLength(1);
  });

  it("saves shared text as a thought named by its first line", async () => {
    const cell = createFakeCell();
    const { shares } = phoneOver(cell.device("phone"));
    const kept = await shares.keep({ kind: "text", text: "Call the printer\n\nabout the proofs" });
    if (kept === null) {
      throw new Error("the outbox refused a share while signed in");
    }
    await expect(shares.deliver(kept.opId)).resolves.toMatchObject({ kind: "landed" });
    expect(cell.item(kept.id)?.fields.title).toBe("Call the printer");
  });

  it("parks a share no resend can land, with its words, until it is sent again or let go", async () => {
    const cell = createFakeCell();
    const { shares, storage } = phoneOver(cell.device("phone"));
    const kept = await shares.keep({ kind: "link", note: null, title: null, url: "ftp://files" });
    if (kept === null) {
      throw new Error("the outbox refused a share while signed in");
    }
    await expect(shares.deliver(kept.opId)).resolves.toStrictEqual({
      kind: "refused",
      message: WEB_URL_RULE,
    });
    expect(shares.waiting.get()).toMatchObject([{ refused: WEB_URL_RULE }]);

    await shares.retry(kept.opId);
    expect(shares.waiting.get()).toMatchObject([{ refused: WEB_URL_RULE }]);
    await shares.discard(kept.opId);
    expect(shares.waiting.get()).toStrictEqual([]);
    expect([...storage.held.keys()]).toStrictEqual([]);
  });

  it("stops a pass at a sign-in the cloud ended, sending nothing after it", async () => {
    const cell = createFakeCell();
    const { ended, shares } = phoneOver(cell.device("phone"));
    await shares.keep({ kind: "link", note: null, title: null, url: PAGE });
    await shares.keep({ kind: "link", note: null, title: null, url: `${PAGE}/2` });
    cell.signOut();

    await shares.flush();
    expect(ended).toStrictEqual(["signed-out"]);
    expect(shares.waiting.get()).toHaveLength(2);
  });

  it("lets every share go when the account is left, and keeps none after", async () => {
    const cell = createFakeCell();
    const device = cell.device("phone");
    const { shares, storage } = phoneOver(device);
    device.setOffline(true);
    await shares.keep({ kind: "link", note: null, title: null, url: PAGE });

    await shares.clear();
    expect(shares.waiting.get()).toStrictEqual([]);
    expect([...storage.held.keys()]).toStrictEqual([]);
    await expect(
      shares.keep({ kind: "link", note: null, title: null, url: PAGE }),
    ).resolves.toBeNull();
  });

  it("keeps a share it could not write as no share, and says so", async () => {
    const cell = createFakeCell();
    const { shares, storage } = phoneOver(cell.device("phone"));
    storage.failWrites(true);
    await expect(shares.keep({ kind: "link", note: null, title: null, url: PAGE })).rejects.toThrow(
      /full/u,
    );
    expect(shares.waiting.get()).toStrictEqual([]);
  });
});
