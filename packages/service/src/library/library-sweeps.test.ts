// Sweeps over Postgres: a scope's every item, thousands of them, landed by one call as the tab asks
// it, and a change of tags too large for one write left as lots that land as writes of their own.

import { randomUUID } from "node:crypto";

import { noteFields, stubFields } from "@repo/contract/library/item-makes";
import { paragraph } from "@repo/contract/test-support/library-items";
import { db } from "@repo/db/drizzle-client";
import { item, itemTag, job, libraryState, purgedItem } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";

import { personalLibrary } from "../test-support/library-fixture";
import { mintLibraryId } from "./library-ids";
import { landNewItems } from "./library-landing";
import type { NewItem } from "./library-landing";
import { writeLibrary } from "./library-store";
import { landSweepLot, sweepLotSchema } from "./library-sweeps";

const PERSON = { kind: "person" } as const;
const SAVED_AT = 1_700_000_000_000;

const noteOf = (text: string, tags: readonly string[] = []): NewItem => {
  const id = mintLibraryId(Date.now());
  return {
    blocks: [{ block: paragraph(`${id}-p`, text), section: "note" }],
    fields: noteFields({ folderId: null, savedAt: SAVED_AT, tags: [...tags], title: "" }),
    id,
  };
};

// many items in one write, as an import lands them
const seed = async (accountId: string, made: readonly NewItem[]): Promise<void> => {
  const landed = await writeLibrary(
    { accountId, actor: PERSON },
    { answer: z.number(), opId: undefined },
    async (scope) => {
      const outcomes = await landNewItems(scope, made);
      return outcomes.filter((outcome) => outcome.ok).length;
    },
  );
  expect(landed).toStrictEqual({ ok: true, value: made.length });
};

const notesOf = (n: number): NewItem[] =>
  Array.from({ length: n }, (_, at) => noteOf(`Loose ${String(at)}.`));

const counted = async (accountId: string, side: "live" | "deleted"): Promise<number> => {
  const [row] = await db
    .select({ n: count() })
    .from(item)
    .where(
      and(
        eq(item.accountId, accountId),
        side === "live" ? isNull(item.deletedAt) : isNotNull(item.deletedAt),
      ),
    );
  return row?.n ?? 0;
};

const headOf = async (accountId: string): Promise<number> => {
  const [row] = await db
    .select({ head: libraryState.head })
    .from(libraryState)
    .where(eq(libraryState.accountId, accountId));
  return row?.head ?? 0;
};

const taggedWith = async (accountId: string, tag: string): Promise<number> => {
  const [row] = await db
    .select({ n: count() })
    .from(itemTag)
    .where(and(eq(itemTag.accountId, accountId), eq(itemTag.tag, tag)));
  return row?.n ?? 0;
};

dbSuite("a sweep over a scope", () => {
  it(
    "lands 5,000 items of each verb in one call, naming the ones a rule left as they were",
    { timeout: 60_000 },
    async () => {
      const { accountId, library } = await personalLibrary();
      const url = "https://pages.example/held";
      const link: NewItem = {
        blocks: [],
        fields: stubFields({ folderId: null, savedAt: SAVED_AT, tags: [], url }),
        id: mintLibraryId(Date.now()),
      };
      const full = noteOf(
        "Full of tags.",
        Array.from({ length: 500 }, (_, at) => `t${String(at)}`),
      );
      await seed(accountId, [link, full, ...notesOf(4998)]);
      const all = { except: [], scope: { kind: "all" as const } };
      const deleted = { except: [], scope: { kind: "deleted" as const } };

      const before = await headOf(accountId);
      await expect(
        library.items.sweep({ ...all, verb: { kind: "delete" } }),
      ).resolves.toStrictEqual({
        items: 5000,
        refused: [],
      });
      await expect(counted(accountId, "deleted")).resolves.toBe(5000);
      await expect(headOf(accountId)).resolves.toBe(before + 1);

      const { item: holder } = await library.items.saveLink({ url });
      await expect(
        library.items.sweep({ ...deleted, verb: { kind: "restore" } }),
      ).resolves.toStrictEqual({ items: 5000, refused: [link.id] });
      await expect(counted(accountId, "live")).resolves.toBe(5000);

      await expect(
        library.items.sweep({
          ...all,
          verb: { addTags: ["swept"], folder: { path: "Archive" }, kind: "organize", pinned: true },
        }),
      ).resolves.toStrictEqual({ items: 5000, refused: [full.id] });
      await expect(taggedWith(accountId, "swept")).resolves.toBe(4999);
      await expect(library.items.row({ id: holder.id })).resolves.toMatchObject({
        fields: { folderId: expect.any(String), pinnedAt: expect.any(Number), tags: ["swept"] },
      });
      const page = await library.listing.page({ limit: 1, scope: { kind: "tag", tag: "swept" } });
      expect(page.total).toBe(4999);
      const found = await library.search({ query: "swept" });
      expect(found.hits.length).toBeGreaterThan(0);

      await library.items.sweep({ ...all, verb: { kind: "delete" } });
      await expect(
        library.items.sweep({ ...deleted, verb: { kind: "purge" } }),
      ).resolves.toStrictEqual({ items: 5001, refused: [] });
      await expect(counted(accountId, "deleted")).resolves.toBe(0);
      const [purged] = await db
        .select({ n: count() })
        .from(purgedItem)
        .where(eq(purgedItem.accountId, accountId));
      expect(purged?.n).toBe(5001);
    },
  );

  it(
    "leaves a change of tags over 5,000 items as lots, each landing as a write of its own",
    { timeout: 60_000 },
    async () => {
      const { accountId, library } = await personalLibrary();
      await seed(accountId, notesOf(5001));
      await expect(
        library.items.sweep({
          except: [],
          scope: { kind: "all" },
          verb: { addTags: ["lot"], kind: "organize", pinned: true },
        }),
      ).resolves.toStrictEqual({ items: 5001, refused: [] });
      const [pinned] = await db
        .select({ n: count() })
        .from(item)
        .where(and(eq(item.accountId, accountId), isNotNull(item.pinnedAt)));
      expect(pinned?.n).toBe(5001);
      await expect(taggedWith(accountId, "lot")).resolves.toBe(0);

      const lots = await db
        .select({ payload: job.payload })
        .from(job)
        .where(and(eq(job.accountId, accountId), eq(job.kind, "sweep")));
      const parsed = lots.map(({ payload }) => sweepLotSchema.parse(payload));
      expect(parsed.map((lot) => lot.ids.length).toSorted((a, b) => a - b)).toStrictEqual([
        1, 5000,
      ]);
      for (const lot of parsed) {
        const landed = await writeLibrary(
          { accountId, actor: PERSON },
          { answer: z.array(z.string()), opId: undefined },
          async (scope) => await landSweepLot(scope, lot),
        );
        expect(landed).toStrictEqual({ ok: true, value: [] });
      }
      await expect(taggedWith(accountId, "lot")).resolves.toBe(5001);
    },
  );

  it("organizes only the kinds it is narrowed to, and none of the items left out", async () => {
    const { accountId, library } = await personalLibrary();
    const kept = noteOf("Left out.");
    const swept = noteOf("Swept.");
    const link: NewItem = {
      blocks: [],
      fields: stubFields({
        folderId: null,
        savedAt: SAVED_AT,
        tags: [],
        url: `https://pages.example/${randomUUID()}`,
      }),
      id: mintLibraryId(Date.now()),
    };
    await seed(accountId, [kept, swept, link]);
    await expect(
      library.items.sweep({
        except: [kept.id],
        kinds: ["note"],
        scope: { kind: "all" },
        verb: { addTags: ["swept"], kind: "organize" },
      }),
    ).resolves.toStrictEqual({ items: 1, refused: [] });
    await expect(library.items.row({ id: swept.id })).resolves.toMatchObject({
      fields: { tags: ["swept"] },
    });
    await expect(library.items.row({ id: kept.id })).resolves.toMatchObject({
      fields: { tags: [] },
    });
    await expect(library.items.row({ id: link.id })).resolves.toMatchObject({
      fields: { tags: [] },
    });
  });
});
