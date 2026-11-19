import { randomUUID } from "node:crypto";

import { deferred } from "@repo/contract/deferred";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { noteFixture } from "@repo/contract/test-support/library-items.test-utils";
import { user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import type { Tx } from "@repo/db/drizzle-client";
import * as librarySchema from "@repo/db/library-schema";
import {
  changeSet,
  changeSetBody,
  changeSetFile,
  changeSetItem,
  file,
  folder,
  itemFile,
  job,
  libraryState,
  opAnswer,
  purgedItem,
} from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { asc, count, eq, getColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { makeAccount, seedItem } from "../test-support/library.fixture";
import { refuse } from "./library-refusal";
import { withAccountLock, writeLibrary } from "./library-store";
import type { WriteScope } from "./library-store";

const NO_OP = undefined;
const PERSON = { kind: "person" } as const;

const headOf = async (accountId: string) => {
  const [row] = await db
    .select({ head: libraryState.head })
    .from(libraryState)
    .where(eq(libraryState.accountId, accountId));

  return row?.head ?? null;
};

const addFolder = async (scope: WriteScope, name: string) => {
  const id = randomUUID();
  await scope.tx.insert(folder).values({
    accountId: scope.accountId,
    id,
    name,
    parentId: null,
    seq: await scope.seq(),
    sort: "a0",
  });

  return id;
};

const foldersOf = async (accountId: string) =>
  await db
    .select({ name: folder.name, seq: folder.seq })
    .from(folder)
    .where(eq(folder.accountId, accountId))
    .orderBy(asc(folder.name));

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

dbSuite("a library write", () => {
  it.each([
    ["a library's first", false],
    ["a library's later", true],
  ])("lands a second write after %s, and another account's at once", async (_first, later) => {
    const mine = await makeAccount();
    const theirs = await makeAccount();
    const landed: string[] = [];

    const stamp = (name: string) => async (scope: WriteScope) => {
      landed.push(name);

      return await scope.seq();
    };

    if (later) {
      await writeLibrary(
        { accountId: mine, actor: PERSON },
        { answer: z.number(), opId: NO_OP },
        stamp("before"),
      );
    }

    const head = later ? 1 : 0;
    const holding = deferred();
    const holder = deferred<number>();

    try {
      const first = writeLibrary(
        { accountId: mine, actor: PERSON },
        { answer: z.number(), opId: NO_OP },
        async (scope) => {
          holder.resolve(await backendOf(scope.tx));
          await holding.promise;

          return await stamp("first")(scope);
        },
      );

      const holderPid = await holder.promise;

      const second = writeLibrary(
        { accountId: mine, actor: PERSON },
        { answer: z.number(), opId: NO_OP },
        stamp("second"),
      );

      await vi.waitFor(async () => {
        expect(await waitersOn(holderPid)).toBe(1);
      });

      const other = await writeLibrary(
        { accountId: theirs, actor: PERSON },
        { answer: z.number(), opId: NO_OP },
        stamp("other"),
      );

      expect(other).toStrictEqual({ ok: true, value: 1 });

      holding.resolve();
      expect(await first).toStrictEqual({ ok: true, value: head + 1 });
      expect(await second).toStrictEqual({ ok: true, value: head + 2 });
      expect(landed.filter((name) => name !== "before")).toStrictEqual([
        "other",
        "first",
        "second",
      ]);
    } finally {
      holding.resolve();
    }
  });

  it("refuses a write as busy once another holds the account's lock past its wait", async () => {
    const accountId = await makeAccount();
    const holding = deferred();
    const held = deferred();

    const holder = withAccountLock(accountId, async () => {
      held.resolve();
      await holding.promise;
    });

    try {
      await held.promise;
      let ran = false;

      const waited = await writeLibrary(
        { accountId, actor: PERSON },
        { answer: z.number(), opId: NO_OP },
        async (scope) => {
          ran = true;

          return await scope.seq();
        },
      );

      expect(waited).toStrictEqual({ ok: false, refusal: { kind: "busy" } });
      expect(ran).toBe(false);
    } finally {
      holding.resolve();
      await holder;
    }

    expect(await headOf(accountId)).toBe(0);
  });

  it("answers a resend by its op id with what landed, and writes nothing", async () => {
    const accountId = await makeAccount();
    const opId = randomUUID();
    const made = z.object({ id: z.string(), seq: z.number() });

    const makeFolder = async (writer: string) =>
      await writeLibrary(
        { accountId: writer, actor: PERSON },
        { answer: made, opId },
        async (scope) => ({
          id: await addFolder(scope, "Projects"),
          seq: await scope.seq(),
        }),
      );

    const first = await makeFolder(accountId);
    expect(first).toMatchObject({ ok: true, value: { seq: 1 } });
    expect(await makeFolder(accountId)).toStrictEqual(first);
    expect(await headOf(accountId)).toBe(1);
    expect(await foldersOf(accountId)).toHaveLength(1);

    const other = await makeAccount();
    const theirs = await makeFolder(other);
    expect(theirs).toMatchObject({ ok: true, value: { seq: 1 } });
    expect(theirs).not.toStrictEqual(first);
  });

  it("takes back a refused attempt alone, the sequence it took with it", async () => {
    const accountId = await makeAccount();

    const result = await writeLibrary(
      { accountId, actor: PERSON },
      { answer: z.number(), opId: NO_OP },
      async (scope) => {
        const refused = await scope.attempt(async (part) => {
          await addFolder(part, "refused");

          return refuse({ kind: "conflict" });
        });

        expect(refused).toStrictEqual({ ok: false, refusal: { kind: "conflict" } });
        await addFolder(scope, "kept");
        const attempted = await scope.attempt(async (part) => await addFolder(part, "attempted"));
        expect(attempted).toMatchObject({ ok: true });

        return await scope.seq();
      },
    );

    expect(result).toStrictEqual({ ok: true, value: 1 });
    expect(await foldersOf(accountId)).toStrictEqual([
      { name: "attempted", seq: 1 },
      { name: "kept", seq: 1 },
    ]);
    expect(await headOf(accountId)).toBe(1);
  });

  it("moves the head once for a write that stamps, and never for one that is refused or fails", async () => {
    const accountId = await makeAccount();

    const stamps = await writeLibrary(
      { accountId, actor: PERSON },
      { answer: z.array(z.number()), opId: NO_OP },
      async (scope) => [await scope.seq(), await scope.seq(), await scope.seq()],
    );

    expect(stamps).toStrictEqual({ ok: true, value: [1, 1, 1] });

    const quiet = await writeLibrary(
      { accountId, actor: PERSON },
      { answer: z.null(), opId: NO_OP },
      async () => null,
    );

    expect(quiet).toStrictEqual({ ok: true, value: null });
    expect(await headOf(accountId)).toBe(1);

    const refused = await writeLibrary(
      { accountId, actor: PERSON },
      { answer: z.string(), opId: NO_OP },
      async (scope) => {
        await addFolder(scope, "refused");

        return refuse({ kind: "not-found" });
      },
    );

    expect(refused).toStrictEqual({ ok: false, refusal: { kind: "not-found" } });
    await expect(
      writeLibrary(
        { accountId, actor: PERSON },
        { answer: z.string(), opId: NO_OP },
        async (scope) => {
          await addFolder(scope, "failed");
          throw new Error("a fault mid-write");
        },
      ),
    ).rejects.toThrow("a fault mid-write");
    expect(await headOf(accountId)).toBe(1);
    expect(await foldersOf(accountId)).toStrictEqual([]);

    const next = await writeLibrary(
      { accountId, actor: PERSON },
      { answer: z.number(), opId: NO_OP },
      async (scope) => await scope.seq(),
    );

    expect(next).toStrictEqual({ ok: true, value: 2 });
  });

  it("kicks its jobs once a write that asked one commits, and never one that asked none or took its ask back", async () => {
    const accountId = await makeAccount();
    const kickJobs = vi.fn<(kicked: string) => void>();
    const writer = { accountId, actor: PERSON, kickJobs };
    const lot = { kind: "sweep" as const, payload: { ids: [] } };

    const jobsOf = async () =>
      await db.select({ id: job.id }).from(job).where(eq(job.accountId, accountId));

    const landed = await writeLibrary(writer, { answer: z.null(), opId: NO_OP }, async (scope) => {
      await scope.askJobs([{ ...lot, id: "sweep:kept" }]);

      return null;
    });

    expect(landed).toStrictEqual({ ok: true, value: null });
    expect(kickJobs.mock.calls).toStrictEqual([[accountId]]);

    kickJobs.mockClear();
    await writeLibrary(writer, { answer: z.null(), opId: NO_OP }, async (scope) => {
      await scope.askJobs([]);
      await scope.attempt(async (part) => {
        await part.askJobs([{ ...lot, id: "sweep:taken-back" }]);

        return refuse({ kind: "not-found" });
      });

      return null;
    });

    const refused = await writeLibrary(writer, { answer: z.null(), opId: NO_OP }, async (scope) => {
      await scope.askJobs([{ ...lot, id: "sweep:refused" }]);

      return refuse({ kind: "not-found" });
    });

    expect(refused).toStrictEqual({ ok: false, refusal: { kind: "not-found" } });
    expect(kickJobs).not.toHaveBeenCalled();
    await expect(jobsOf()).resolves.toStrictEqual([{ id: "sweep:kept" }]);
  });
});

const LIBRARY_TABLES = Object.values(librarySchema).filter((value) => is(value, PgTable));

const rowsOf: (accountId: string) => Promise<Record<string, number>> = async (accountId: string) =>
  Object.fromEntries(
    await Promise.all(
      LIBRARY_TABLES.map(async (table) => {
        const { accountId: owner } = getColumns(table);

        if (owner === undefined) {
          throw new Error(`${getTableName(table)} has no account_id`);
        }

        const [row] = await db.select({ rows: count() }).from(table).where(eq(owner, accountId));

        return [getTableName(table), row?.rows ?? 0];
      }),
    ),
  );

const linkedNote = (target: string) =>
  ({
    children: [
      { text: "about #inline " },
      { children: [{ text: "a page" }], type: "a", url: "https://example.com/page" },
      { children: [{ text: "" }], key: target, type: "mention", value: "Elsewhere" },
    ],
    id: "p1",
    type: "p",
  }) satisfies LibraryBlock;

const fillLibrary = async (accountId: string) => {
  const elsewhere = await seedItem(accountId, { fields: noteFixture({ title: "Elsewhere" }) });

  const note = await seedItem(accountId, {
    blocks: [{ block: linkedNote(elsewhere.id), section: "note" }],
    fields: noteFixture({ tags: ["field"] }),
  });

  const sha256 = "a".repeat(64);
  const changeSetId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(libraryState).values({ accountId, head: 3 });
    await tx.insert(purgedItem).values({ accountId, id: randomUUID(), seq: 2 });
    await tx.insert(folder).values({
      accountId,
      id: randomUUID(),
      name: "Projects",
      parentId: null,
      seq: 1,
      sort: "a0",
    });
    await tx.insert(changeSet).values({ accountId, id: changeSetId, threadId: "thread", turn: 1 });
    await tx
      .insert(changeSetItem)
      .values({ accountId, changeSetId, inverse: [], itemId: note.id, made: null });
    await tx.insert(changeSetBody).values({
      accountId,
      blocksBefore: [],
      changeSetId,
      itemId: note.id,
      versionAfter: 2,
      versionBefore: 1,
    });
    await tx
      .insert(opAnswer)
      .values({ accountId, answer: { landed: true }, at: 1, opId: randomUUID() });
    await tx.insert(file).values({
      accountId,
      bytes: 3,
      createdAt: 1,
      mime: "text/plain",
      pathname: `files/${accountId}/${sha256}/${randomUUID()}`,
      sha256,
      touchedAt: 1,
    });
    await tx.insert(itemFile).values({ accountId, itemId: note.id, sha256 });
    await tx.insert(changeSetFile).values({ accountId, changeSetId, itemId: note.id, sha256 });
    await tx.insert(job).values({
      accountId,
      createdAt: 1,
      id: `fill:${note.id}`,
      kind: "fill",
      payload: { itemId: note.id },
      runAt: 1,
    });
  });
};

dbSuite("deleting an account", () => {
  it("empties every library table of its rows, and of no other account's", async () => {
    const gone = await makeAccount();
    const kept = await makeAccount();
    await fillLibrary(gone);
    await fillLibrary(kept);
    const held = await rowsOf(kept);
    expect(Object.entries(held).filter(([, rows]) => rows === 0)).toStrictEqual([]);
    expect(await rowsOf(gone)).toStrictEqual(held);

    await db.delete(user).where(eq(user.id, gone));

    const left = await rowsOf(gone);
    expect(Object.entries(left).filter(([, rows]) => rows > 0)).toStrictEqual([]);
    expect(await rowsOf(kept)).toStrictEqual(held);
  });
});
