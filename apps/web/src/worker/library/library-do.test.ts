import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../db/client";
import { device, inviteCode } from "../db/schema";
import { loginDevice, signUpUser, userIdOf } from "../test-support/cloud-helpers";
import {
  cellOf,
  clockAt,
  engineIn,
  inCell,
  landedValue,
  newAccountId,
  noteFields,
  paragraph,
  person,
  placed,
  refusalOf,
  SYSTEM,
} from "../test-support/library-cell";
import { ACCOUNT_PURGE_STEPS } from "./account-purge";
import { accountBlobPrefix, blobKey } from "./cell-blobs";
import { openCellLibrary, scheduleAlarm, settleCommit } from "./cell-library";
import type { CellRefusal } from "./cell-refusal";
import { cellAccountId } from "./library-cell";

const SHA = "d".repeat(64);

const files = async (prefix: string): Promise<number> => {
  const listing = await env.BLOBS.list({ prefix });
  return listing.objects.length;
};

const itemCount = (state: DurableObjectState): number =>
  Number(state.storage.sql.exec("SELECT count(*) AS n FROM items").one()["n"]);

describe("the library cell", () => {
  it("reads its account back from its own name, and is named by nothing else", async () => {
    const accountId = newAccountId();
    const name = await inCell(cellOf(accountId), (state) => state.id.name);
    expect(cellAccountId(name)).toBe(accountId);
    expect(() => cellAccountId("user:someone")).toThrow();
    expect(() => cellAccountId("library:")).toThrow();
  });

  it("keeps each account's library to its own cell", async () => {
    const mine = cellOf();
    const theirs = cellOf();
    await inCell(mine, (state) => {
      landedValue(
        engineIn(state, clockAt()).create(SYSTEM, {
          blocks: placed([paragraph("a", "mine")]),
          fields: noteFields(),
          id: crypto.randomUUID(),
        }),
      );
    });
    const pulled = await inCell(theirs, (state) =>
      landedValue(engineIn(state, clockAt()).pull({ cursor: 0, epoch: null })),
    );
    expect(pulled).toMatchObject({ changes: [], head: 0, kind: "changes" });
  });

  it("seals a quiet set when its alarm runs, and sets the next one for the prune", async () => {
    const stub = cellOf();
    const written = Date.now() - 20_000;
    await inCell(stub, async (state) => {
      const library = engineIn(state, clockAt(written));
      landedValue(
        library.create(person(), {
          blocks: placed([paragraph("a", "typed a while ago")]),
          fields: noteFields(),
          id: crypto.randomUUID(),
        }),
      );
      // the job is due; the alarm is held a minute out so the test runs it, not the clock
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const after = await inCell(stub, async (state) => ({
      alarm: await state.storage.getAlarm(),
      sealed: state.storage.sql.exec("SELECT sealed_at FROM change_sets").one()["sealed_at"],
    }));
    expect(after.sealed).toEqual(expect.any(Number));
    // the prune job, a day after the seal
    expect(after.alarm).toBeGreaterThan(Date.now() + 23 * 60 * 60_000);
  });

  it("loses nothing to an eviction: the rows, the open set and its alarm", async () => {
    const stub = cellOf();
    const itemId = crypto.randomUUID();
    const alarm = await inCell(stub, async (state) => {
      const library = openCellLibrary(state, env);
      const result = library.create(person(), {
        blocks: placed([paragraph("a", "before the eviction")]),
        fields: noteFields(),
        id: itemId,
      });
      await settleCommit(state, library, result);
      return await state.storage.getAlarm();
    });
    expect(alarm).toEqual(expect.any(Number));
    await evictDurableObject(stub);
    const after = await inCell(stub, async (state) => {
      const library = openCellLibrary(state, env);
      const [body] = landedValue(library.bodies([itemId])).bodies;
      return {
        alarm: await state.storage.getAlarm(),
        body: body?.blocks.length,
        open: state.storage.sql
          .exec("SELECT count(*) AS n FROM change_sets WHERE sealed_at IS NULL")
          .one()["n"],
      };
    });
    expect(after).toEqual({ alarm, body: 1, open: 1 });
  });

  it("starts over under a new epoch when its schema is of another version", async () => {
    const stub = cellOf();
    const before = await inCell(stub, (state) => {
      const library = engineIn(state, clockAt());
      landedValue(
        library.create(SYSTEM, {
          blocks: placed([paragraph("a", "an older build's")]),
          fields: noteFields(),
          id: crypto.randomUUID(),
        }),
      );
      state.storage.sql.exec("UPDATE meta SET v = 1 WHERE k = 'schema'");
      return landedValue(library.pull({ cursor: 0, epoch: null }));
    });
    await evictDurableObject(stub);
    const after = await inCell(stub, (state) =>
      landedValue(engineIn(state, clockAt()).pull({ cursor: 0, epoch: before.epoch })),
    );
    expect(after.kind).toBe("reset");
    expect(after.epoch).not.toBe(before.epoch);
  });

  it("holds room for an upload, lands its row once R2 has it, and answers a resend as held", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    const request = { bytes: 5, mime: "image/png", sha: SHA };
    expect(await stub.reserveBlob(request)).toEqual({
      head: null,
      ok: true,
      value: { held: false },
    });
    expect(await stub.settleBlob(SHA)).toEqual({ head: null, ok: true, value: { settled: false } });
    await stub.reserveBlob(request);
    await env.BLOBS.put(blobKey(accountId, SHA), "bytes", {
      httpMetadata: { contentType: "image/png" },
    });
    expect(await stub.settleBlob(SHA)).toEqual({ head: 1, ok: true, value: { settled: true } });
    expect(await stub.reserveBlob(request)).toEqual({
      head: null,
      ok: true,
      value: { held: true },
    });
  });
  it("takes an upload it refused out of R2 when its alarm runs", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    const key = blobKey(accountId, SHA);
    await inCell(stub, async (state) => {
      const library = engineIn(state, clockAt(), state.storage.sql.databaseSize + 1000);
      landedValue(library.reserve({ bytes: 5, mime: "image/png", sha: SHA }));
      const removalsSeen = library.blobRemovals();
      // the device sent more than the cap leaves room for
      await env.BLOBS.put(key, "x".repeat(10_000));
      const refused = library.settle(SHA, { bytes: 10_000, mime: "image/png" }, removalsSeen);
      expect(refusalOf(refused)).toMatchObject({ kind: "quota" });
      // the removal is due; the alarm is held a minute out so the test runs it, not the clock
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await env.BLOBS.head(key)).not.toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await env.BLOBS.head(key)).toBeNull();
    const strays = await inCell(stub, (state) =>
      state.storage.sql.exec("SELECT id FROM jobs WHERE kind = 'stray'").toArray(),
    );
    expect(strays).toEqual([]);
  });
});

describe("deleting the account from its cell", () => {
  it("runs its steps in order: the tombstone, the cell's storage, its files, its credentials", async () => {
    expect(ACCOUNT_PURGE_STEPS.map((step) => step.name)).toEqual([
      "tombstone",
      "storage",
      "files",
      "credentials",
    ]);
    const email = "purge-order@example.test";
    const { cookie } = await signUpUser(email);
    await loginDevice(cookie, "Laptop");
    const accountId = await userIdOf(cookie);
    const stranger = newAccountId();
    await env.BLOBS.put(blobKey(accountId, SHA), "mine");
    await env.BLOBS.put(blobKey(stranger, SHA), "theirs");
    const db = createDb(env.DB);
    const devices = async (): Promise<number> => {
      const rows = await db.select().from(device).where(eq(device.userId, accountId)).all();
      return rows.length;
    };
    // what each step left behind, and what a read meeting the cell then heard
    interface Seen {
      readonly alarm: number | null;
      readonly devices: number;
      readonly files: number;
      readonly items: number;
      readonly read: CellRefusal | null;
    }
    const seen = new Map<string, Seen>();
    await inCell(cellOf(accountId), async (state) => {
      landedValue(
        engineIn(state, clockAt()).create(SYSTEM, {
          blocks: placed([paragraph("a", "gone with the account")]),
          fields: noteFields(),
          id: crypto.randomUUID(),
        }),
      );
      await scheduleAlarm(state, openCellLibrary(state, env));
      const scope = { accountId, ctx: state, email, env };
      for (const step of ACCOUNT_PURGE_STEPS) {
        await step.run(scope);
        seen.set(step.name, {
          alarm: await state.storage.getAlarm(),
          devices: await devices(),
          files: await files(accountBlobPrefix(accountId)),
          items: itemCount(state),
          read: refusalOf(engineIn(state, clockAt()).pull({ cursor: 0, epoch: null })),
        });
      }
    });
    const gone = { kind: "gone" };
    expect(Object.fromEntries(seen)).toEqual({
      credentials: { alarm: null, devices: 0, files: 0, items: 0, read: gone },
      files: { alarm: null, devices: 1, files: 0, items: 0, read: gone },
      storage: { alarm: null, devices: 1, files: 1, items: 0, read: gone },
      tombstone: { alarm: expect.any(Number), devices: 1, files: 1, items: 1, read: gone },
    });
    // another account's files stay, and the invite's redeemer is forgotten
    expect(await files(accountBlobPrefix(stranger))).toBe(1);
    const invites = await db.select().from(inviteCode).all();
    expect(invites.some((invite) => invite.redeemedBy === email)).toBe(false);
  });

  it("empties the account's files page by page, past one listing's thousand", async () => {
    const accountId = newAccountId();
    const prefix = accountBlobPrefix(accountId);
    for (let index = 0; index < 1005; index += 1) {
      await env.BLOBS.put(blobKey(accountId, index.toString(16).padStart(64, "0")), "x");
    }
    const before = await env.BLOBS.list({ prefix });
    expect(before.truncated).toBe(true);
    const filesStep = ACCOUNT_PURGE_STEPS.find((step) => step.name === "files");
    await inCell(cellOf(accountId), async (state) => {
      await filesStep?.run({ accountId, ctx: state, email: "files-paged@example.test", env });
    });
    expect(await files(prefix)).toBe(0);
  });

  it("runs again from the top after a step failed, as Better Auth retries the deletion", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    await inCell(stub, async (state) => {
      const scope = { accountId, ctx: state, email: "never-signed-up@example.test", env };
      const [tombstone, storage] = ACCOUNT_PURGE_STEPS;
      await tombstone?.run(scope);
      await storage?.run(scope);
      for (const step of ACCOUNT_PURGE_STEPS) {
        await step.run(scope);
      }
    });
    // the tombstone outlives the deletion and a wake: a call that verified before the
    // credentials went founds no library
    await evictDurableObject(stub);
    const after = await inCell(stub, (state) => ({
      items: itemCount(state),
      read: refusalOf(engineIn(state, clockAt()).pull({ cursor: 0, epoch: null })),
    }));
    expect(after).toEqual({ items: 0, read: { kind: "gone" } });
    expect(await stub.reserveBlob({ bytes: 5, mime: "image/png", sha: SHA })).toEqual({
      ok: false,
      refusal: { kind: "gone" },
    });
  });
});
