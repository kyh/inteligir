import { randomUUID } from "node:crypto";

import { deferred } from "@repo/contract/deferred";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { db } from "@repo/db/drizzle-client";
import type { Tx } from "@repo/db/drizzle-client";
import { itemBody, libraryState } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { libraryAs, personalLibrary } from "../test-support/library.fixture";
import { mintLibraryId } from "../library/library-ids";
import { writeLibrary } from "../library/library-store";
import { writeBody } from "./write-body";

const PERSON = { kind: "person" } as const;

const line = (text: string, section: "note" | "article" = "note") =>
  ({
    block: paragraph(randomUUID(), text),
    section,
  }) satisfies BodyBlock;

const noteOf = (blocks: readonly BodyBlock[]) => ({
  blocks: [...blocks],
  folderId: null,
  id: mintLibraryId(Date.now()),
  savedAt: Date.now(),
  tags: [],
  title: "",
});

const agentOf = (accountId: string) =>
  libraryAs({ accountId, actor: { kind: "agent", threadId: randomUUID(), turn: 1 } });

type Library = ReturnType<typeof libraryAs>;

const textsOf = async (library: Library, id: string) => {
  const { blocks } = await library.items.get({ id });

  return blocks.map(({ block }) =>
    "children" in block
      ? block.children.map((child) => ("text" in child ? child.text : "")).join("")
      : "",
  );
};

const refusalOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (isOrpcError(error)) {
      return { code: error.code, data: error.data };
    }

    throw error;
  }

  throw new Error("the call landed what the test expected it to refuse");
};

const backendsSchema = z.array(z.object({ pid: z.number() }));

const backendOf = async (tx: Tx) => {
  const [backend] = backendsSchema.parse(
    await tx.execute(sql`select pg_backend_pid() as pid`, "objects"),
  );

  if (backend === undefined) {
    throw new Error("the transaction has no backend");
  }

  return backend.pid;
};

const waitersOn = async (holder: number) =>
  backendsSchema.parse(
    await db.execute(
      sql`select pid from pg_stat_activity where ${holder}::int = any(pg_blocking_pids(pid))`,
      "objects",
    ),
  ).length;

const lockWaiters = async () =>
  backendsSchema.parse(
    await db.execute(
      sql`select pid from pg_stat_activity
        where wait_event_type = 'Lock' and datname = current_database()`,
      "objects",
    ),
  ).length;

const holdSave = (accountId: string, itemId: string) => {
  const holder = deferred<number>();
  const letGo = deferred<{ baseVersion: number; blocks: readonly BodyBlock[] }>();

  const held = writeLibrary(
    { accountId, actor: PERSON },
    { answer: z.null(), opId: undefined },
    async (scope) => {
      holder.resolve(await backendOf(scope.tx));
      await writeBody(scope, { ...(await letGo.promise), itemId });

      return null;
    },
  );

  return {
    held,
    holder: holder.promise,
    saving: (baseVersion: number, blocks: readonly BodyBlock[]) => {
      letGo.resolve({ baseVersion, blocks });
    },
  };
};

const holdVersion = (accountId: string, itemId: string) => {
  const holder = deferred<number>();
  const letGo = deferred();

  const held = db.transaction(async (tx) => {
    await tx
      .select({ accountId: libraryState.accountId })
      .from(libraryState)
      .where(eq(libraryState.accountId, accountId))
      .for("update");
    holder.resolve(await backendOf(tx));
    await letGo.promise;
    await tx
      .update(itemBody)
      .set({ version: sql`${itemBody.version} + 1` })
      .where(and(eq(itemBody.accountId, accountId), eq(itemBody.itemId, itemId)));
  });

  return {
    held,
    holder: holder.promise,
    letGo: () => {
      letGo.resolve();
    },
  };
};

dbSuite("an edit of a note by passages", () => {
  it("replaces a passage in place, every other block kept with its id, and answers the item's sequence", async () => {
    const { accountId, library } = await personalLibrary();

    const [alpha, bravo, charlie] = [
      line("Alpha one."),
      line("Bravo two."),
      line("Charlie three."),
    ];

    const made = noteOf([alpha, bravo, charlie]);
    await library.items.create(made);
    const agent = agentOf(accountId);

    const { seq } = await agent.items.edit({
      edits: [{ newText: "Bravo, edited.", oldText: "Bravo two." }],
      id: made.id,
    });

    const edited = await library.items.get({ id: made.id });
    expect(edited).toMatchObject({ bodyVersion: 2, seq });
    expect(edited.blocks.map(({ block }) => block.id)).toStrictEqual(
      [alpha, bravo, charlie].map(({ block }) => block.id),
    );
    await expect(textsOf(library, made.id)).resolves.toStrictEqual([
      "Alpha one.",
      "Bravo, edited.",
      "Charlie three.",
    ]);

    await agent.items.edit({ edits: [{ newText: "Delta.", oldText: "" }], id: made.id });
    await expect(textsOf(library, made.id)).resolves.toStrictEqual([
      "Alpha one.",
      "Bravo, edited.",
      "Charlie three.",
      "Delta.",
    ]);
  });

  it("refuses old text that stands nowhere, more than once or in the article, landing nothing", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf([line("Same."), line("Same."), line("Article words.", "article")]);
    await library.items.create(made);
    const agent = agentOf(accountId);

    const edit = async (oldText: string) =>
      await refusalOf(agent.items.edit({ edits: [{ newText: "New.", oldText }], id: made.id }));

    await expect(edit("Nowhere.")).resolves.toStrictEqual({
      code: "UNPROCESSABLE_CONTENT",
      data: { edit: 0, kind: "missing" },
    });
    await expect(edit("Same.")).resolves.toStrictEqual({
      code: "UNPROCESSABLE_CONTENT",
      data: { count: 2, edit: 0, kind: "ambiguous" },
    });
    await expect(edit("Article words.")).resolves.toStrictEqual({
      code: "UNPROCESSABLE_CONTENT",
      data: { edit: 0, kind: "section" },
    });
    await expect(library.items.row({ id: made.id })).resolves.toMatchObject({ bodyVersion: 1 });
  });

  it("refuses an edit of a note in Deleted, or of one never made, as not found", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf([line("Soon deleted.")]);
    await library.items.create(made);
    await library.items.delete({ ids: [made.id] });
    const agent = agentOf(accountId);
    const edits = [{ newText: "Late.", oldText: "Soon deleted." }];

    await expect(refusalOf(agent.items.edit({ edits, id: made.id }))).resolves.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      refusalOf(agent.items.edit({ edits, id: mintLibraryId(Date.now()) })),
    ).resolves.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers an edit sent again under its op id from what it landed", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf([line("Before.")]);
    await library.items.create(made);
    const agent = agentOf(accountId);

    const call = {
      edits: [{ newText: "After.", oldText: "Before." }],
      id: made.id,
      opId: randomUUID(),
    };

    const landed = await agent.items.edit(call);
    await expect(agent.items.edit(call)).resolves.toStrictEqual(landed);
    await expect(textsOf(library, made.id)).resolves.toStrictEqual(["After."]);
    await expect(library.items.row({ id: made.id })).resolves.toMatchObject({ bodyVersion: 2 });
  });

  it("makes an edit again over a save that landed while it was made, keeping both", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf([line("Alpha."), line("Bravo.")]);
    await library.items.create(made);
    const save = holdSave(accountId, made.id);
    const holder = await save.holder;

    const edit = agentOf(accountId).items.edit({
      edits: [{ newText: "Alpha, edited.", oldText: "Alpha." }],
      id: made.id,
    });

    await vi.waitFor(async () => {
      expect(await waitersOn(holder)).toBe(1);
    });
    save.saving(1, [...made.blocks, line("Charlie, typed meanwhile.")]);
    await save.held;

    const { seq } = await edit;
    await expect(library.items.row({ id: made.id })).resolves.toMatchObject({
      bodyVersion: 3,
      seq,
    });
    await expect(textsOf(library, made.id)).resolves.toStrictEqual([
      "Alpha, edited.",
      "Bravo.",
      "Charlie, typed meanwhile.",
    ]);
  });

  it("refuses an edit as busy when the body moves under each of its tries", async () => {
    const { accountId, library } = await personalLibrary();
    const made = noteOf([line("Alpha.")]);
    await library.items.create(made);
    const first = holdVersion(accountId, made.id);
    const firstHolder = await first.holder;

    const edit = refusalOf(
      agentOf(accountId).items.edit({
        edits: [{ newText: "Alpha, edited.", oldText: "Alpha." }],
        id: made.id,
      }),
    );

    await vi.waitFor(async () => {
      expect(await waitersOn(firstHolder)).toBe(1);
    });
    const second = holdVersion(accountId, made.id);
    await vi.waitFor(async () => {
      expect(await lockWaiters()).toBe(2);
    });
    first.letGo();
    const secondHolder = await second.holder;
    await vi.waitFor(async () => {
      expect(await waitersOn(secondHolder)).toBe(1);
    });
    second.letGo();

    await expect(edit).resolves.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await Promise.all([first.held, second.held]);
    await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
      blocks: made.blocks,
      bodyVersion: 3,
    });
  });
});
