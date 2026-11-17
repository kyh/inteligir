import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import { db } from "@repo/db/drizzle-client";
import { item, itemBody, itemLink, itemTag } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { makeAccount, seedItem } from "../test-support/library-fixture";
import { linkRowsOf, readItem } from "./library-rows";

dbSuite("an item's rows", () => {
  it("read back as the item they were written from, times and JSON whole", async () => {
    const accountId = await makeAccount();
    const fields = noteFixture({
      aliases: ["Other name"],
      deletedAt: 1_700_000_000_123,
      pinnedAt: 1_700_000_000_456,
      properties: { rating: 5, status: "draft", tags: ["a", "b"] },
      tags: ["Work"],
      title: "Ünïcode Title",
    });
    const stored = await seedItem(accountId, {
      blocks: [{ block: paragraph("p1", "the first line"), section: "note" }],
      fields,
      seq: 7,
    });
    expect(await readItem(db, accountId, stored.id)).toStrictEqual(stored);

    const [row] = await db
      .select({ pinned: item.pinned, titleSort: item.titleSort })
      .from(item)
      .where(eq(item.id, stored.id));
    expect(row).toStrictEqual({ pinned: true, titleSort: "ünïcode title" });
  });

  it("are read only under the account that holds them", async () => {
    const accountId = await makeAccount();
    const stored = await seedItem(accountId, { fields: noteFixture() });
    expect(await readItem(db, await makeAccount(), stored.id)).toBeNull();
    expect(await readItem(db, accountId, randomUUID())).toBeNull();
  });

  it("keep the body's bytes, its tags by their lowercased key and each link once", async () => {
    const accountId = await makeAccount();
    const target = randomUUID();
    const blocks: readonly BodyBlock[] = [
      {
        block: {
          children: [
            { text: "see #Inline and " },
            { children: [{ text: "" }], key: target, type: "mention", value: "Them" },
            { children: [{ text: "" }], key: target, type: "mention", value: "Them" },
          ],
          id: "p1",
          type: "p",
        },
        section: "note",
      },
    ];
    const stored = await seedItem(accountId, { blocks, fields: noteFixture({ tags: ["Work"] }) });

    const [body] = await db
      .select({ bytes: itemBody.bytes })
      .from(itemBody)
      .where(eq(itemBody.itemId, stored.id));
    expect(body?.bytes).toBe(Buffer.byteLength(JSON.stringify(blocks)));
    expect(
      await db
        .select({ origin: itemTag.origin, tag: itemTag.tag, tagKey: itemTag.tagKey })
        .from(itemTag)
        .where(eq(itemTag.itemId, stored.id))
        .orderBy(asc(itemTag.origin)),
    ).toStrictEqual([
      { origin: "field", tag: "Work", tagKey: "work" },
      { origin: "inline", tag: "Inline", tagKey: "inline" },
    ]);
    expect(
      await db
        .select({ targetId: itemLink.targetId })
        .from(itemLink)
        .where(eq(itemLink.sourceId, stored.id)),
    ).toStrictEqual([{ targetId: target }]);
  });
});

describe(linkRowsOf, () => {
  it("keeps a link to an item and one to an address apart", () => {
    expect(
      linkRowsOf("account", "source", [
        { targetId: "item", targetKey: null },
        { targetId: null, targetKey: "example.com/page" },
        { targetId: null, targetKey: "example.com/page" },
      ]),
    ).toStrictEqual([
      { accountId: "account", sourceId: "source", targetId: "item", targetKey: null },
      { accountId: "account", sourceId: "source", targetId: null, targetKey: "example.com/page" },
    ]);
  });
});
