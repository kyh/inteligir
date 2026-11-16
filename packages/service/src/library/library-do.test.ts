import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "@repo/db/d1/client";
import { inviteCode } from "@repo/db/d1/schema";
import { connectorAuth } from "../connector/connector-auth";
import { signUpUser, userIdOf } from "../test-support/cloud-helpers";
import { connectAssistant } from "../test-support/connector-session";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import {
  blocksOf,
  cellOf,
  clockAt,
  createItem,
  cellIn,
  inCell,
  landedValue,
  newAccountId,
  openTurn,
  PERSON,
  placed,
  refusalOf,
} from "../test-support/library-cell";
import { threadHolds, threadOf } from "../test-support/agent-turns";
import { SCHEMA_HASH_KEY } from "../object-schema";
import { ACCOUNT_PURGE_STEPS } from "./account-purge";
import { accountBlobPrefix, blobKey } from "./cell-blobs";
import { FILL_ACTOR } from "./cell-fills";
import { scheduleJob } from "./cell-jobs";
import type { CellRefusal } from "./cell-refusal";
import { cellDbOf } from "./cell-db";
import { cellAccountId } from "./library-cell";
import {
  appPrincipalSchema,
  connectorPrincipalSchema,
  withoutCredentials,
} from "./library-principal";
import type { AppPrincipal, ConnectorPrincipal } from "./library-principal";
import { V1_LIBRARY_RPC_PATH } from "./library-rpc";

const SHA = "d".repeat(64);

const files = async (prefix: string): Promise<number> => {
  const listing = await env.BLOBS.list({ prefix });
  return listing.objects.length;
};

// a tab's session as the Worker verifies it, for the account named
const principal = (accountId: string): AppPrincipal => ({
  accountId,
  actor: { door: "page", kind: "session", sessionId: "laptop-1" },
});

const itemCount = (state: DurableObjectState): number =>
  Number(state.storage.sql.exec("SELECT count(*) AS n FROM items").one().n);

// a person's note, landed on the platform's alarm, its op's answer kept until the prune
const writeNote = (state: DurableObjectState): void => {
  landedValue(
    createItem(cellIn(state, { alarm: "platform" }).library, PERSON, {
      blocks: placed([paragraph("a", "typed just now")]),
      fields: noteFixture(),
      id: crypto.randomUUID(),
      opId: crypto.randomUUID(),
    }),
  );
};

describe("the library cell", () => {
  it("reads its account back from its own name, and is named by nothing else", async () => {
    const accountId = newAccountId();
    const name = await inCell(cellOf(accountId), (state) => state.id.name);
    expect(cellAccountId(name)).toBe(accountId);
    expect(() => cellAccountId("user:someone")).toThrow(
      "a library cell is named library:<accountId>",
    );
    expect(() => cellAccountId("library:")).toThrow("a library cell is named library:<accountId>");
  });

  it("keeps each account's library to its own cell", async () => {
    const mine = cellOf();
    const theirs = cellOf();
    await inCell(mine, (state) => {
      landedValue(
        createItem(cellIn(state, { clock: clockAt() }).library, FILL_ACTOR, {
          blocks: placed([paragraph("a", "mine")]),
          fields: noteFixture(),
          id: crypto.randomUUID(),
        }),
      );
    });
    await expect(inCell(mine, itemCount)).resolves.toBe(1);
    await expect(inCell(theirs, itemCount)).resolves.toBe(0);
  });

  it("takes a library call only under a principal of its own account", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    const call = async (as: AppPrincipal): Promise<number> => {
      const answer = await stub.serveLibrary(
        new Request(`https://cell.test${V1_LIBRARY_RPC_PATH}/items/createNote`, {
          body: JSON.stringify({ json: { markdown: "Who wrote this?" } }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        as,
      );
      await answer.arrayBuffer();
      return answer.status;
    };
    await expect(call(principal(newAccountId()))).rejects.toThrow(
      "a library cell serves its own account alone",
    );
    await expect(inCell(stub, itemCount)).resolves.toBe(0);
    // the same call, under its own account's principal, lands
    await expect(call(principal(accountId))).resolves.toBe(200);
    await expect(inCell(stub, itemCount)).resolves.toBe(1);
  });

  it("is handed a call without the credentials it came by", () => {
    const { headers } = withoutCredentials(
      new Request("https://cell.test/v1/rpc/library/items/list", {
        headers: {
          authorization: "Bearer a-session",
          "content-type": "application/json",
          cookie: "session_token=a-session",
        },
        method: "POST",
      }),
    );
    expect([...headers.keys()]).toStrictEqual(["content-type"]);
  });

  it("takes each door's own kind of principal, and leaves a limit to an assistant's grant", () => {
    const laptop = principal(newAccountId());
    const assistant: ConnectorPrincipal = {
      accountId: laptop.accountId,
      actor: {
        clientId: "client-1",
        clientName: "Claude",
        grantId: "grant-1",
        kind: "assistant",
        scopes: ["library"],
      },
    };
    expect(appPrincipalSchema.parse(laptop)).toStrictEqual(laptop);
    expect(connectorPrincipalSchema.parse(assistant)).toStrictEqual(assistant);
    expect(appPrincipalSchema.safeParse(assistant).success).toBe(false);
    expect(connectorPrincipalSchema.safeParse(laptop).success).toBe(false);
    // no device reads as read-only
    const scopes = ["library:read"];
    for (const claim of [
      { ...laptop, scopes },
      { ...laptop, actor: { ...laptop.actor, scopes } },
    ]) {
      expect(appPrincipalSchema.safeParse(claim).success).toBe(false);
    }
  });

  it("sets its alarm in the turn a write commits, so a cell cut off there keeps both or neither", async () => {
    const accountId = newAccountId();
    const held = async () =>
      await inCell(cellOf(accountId), async (state) => ({
        alarm: await state.storage.getAlarm(),
        items: itemCount(state),
      }));
    await expect(
      inCell(cellOf(accountId), (state) => {
        writeNote(state);
        state.abort("cut off as the write returned");
      }),
    ).rejects.toThrow("cut off as the write returned");
    await expect(held()).resolves.toStrictEqual({ alarm: null, items: 0 });
    await inCell(cellOf(accountId), writeNote);
    await expect(held()).resolves.toStrictEqual({ alarm: expect.any(Number), items: 1 });
  });

  it("loses nothing to an eviction: the rows and the open turn's set", async () => {
    const stub = cellOf();
    const itemId = crypto.randomUUID();
    await inCell(stub, (state) => {
      const cell = cellIn(state, { alarm: "platform" });
      landedValue(
        createItem(cell.library, openTurn(cell).actor, {
          blocks: placed([paragraph("a", "before the eviction")]),
          fields: noteFixture(),
          id: itemId,
        }),
      );
    });
    await evictDurableObject(stub);
    const after = await inCell(stub, (state) => {
      const { library } = cellIn(state);
      return {
        body: blocksOf(library, itemId).length,
        open: state.storage.sql
          .exec("SELECT count(*) AS n FROM change_sets WHERE sealed_at IS NULL")
          .one().n,
      };
    });
    expect(after).toStrictEqual({ body: 1, open: 1 });
  });

  it("wakes started over empty when another build's DDL made it", async () => {
    const stub = cellOf();
    await inCell(stub, (state) => {
      landedValue(
        createItem(cellIn(state, { clock: clockAt() }).library, FILL_ACTOR, {
          blocks: placed([paragraph("a", "a later build's")]),
          fields: noteFixture(),
          id: crypto.randomUUID(),
        }),
      );
      state.storage.kv.put(SCHEMA_HASH_KEY, "later");
    });
    await evictDurableObject(stub);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(inCell(stub, itemCount)).resolves.toBe(0);
    expect(warned).toHaveBeenCalledWith({
      event: "cell-schema-reset",
      found: expect.objectContaining({ hash: "later" }),
    });
    warned.mockRestore();
  });

  it("holds room for an upload, lands its row once R2 has it, and answers a resend as held", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    const request = { bytes: 5, mime: "image/png", sha: SHA };
    await expect(stub.reserveBlob(request)).resolves.toStrictEqual({
      ok: true,
      value: { held: false },
    });
    await expect(stub.settleBlob(SHA)).resolves.toStrictEqual({
      ok: true,
      value: { settled: false },
    });
    await stub.reserveBlob(request);
    await env.BLOBS.put(blobKey(accountId, SHA), "bytes", {
      httpMetadata: { contentType: "image/png" },
    });
    await expect(stub.settleBlob(SHA)).resolves.toStrictEqual({
      ok: true,
      value: { settled: true },
    });
    await expect(stub.reserveBlob(request)).resolves.toStrictEqual({
      ok: true,
      value: { held: true },
    });
  });

  it("takes an upload it refused out of R2 when its alarm runs", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    const key = blobKey(accountId, SHA);
    await inCell(stub, async (state) => {
      const { library } = cellIn(state, {
        bytesCap: state.storage.sql.databaseSize + 1000,
        clock: clockAt(),
      });
      landedValue(library.reserve({ bytes: 5, mime: "image/png", sha: SHA }));
      const removalsSeen = library.blobRemovals();
      // the device sent more than the cap leaves room for
      await env.BLOBS.put(key, "x".repeat(10_000));
      const refused = library.settle(SHA, { bytes: 10_000, mime: "image/png" }, removalsSeen);
      expect(refusalOf(refused)).toMatchObject({ kind: "quota" });
      // the removal is due; the alarm is held a minute out so the test runs it, not the clock
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    await expect(env.BLOBS.head(key)).resolves.not.toBeNull();
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    await expect(env.BLOBS.head(key)).resolves.toBeNull();
    const strays = await inCell(stub, (state) =>
      state.storage.sql.exec("SELECT id FROM jobs WHERE kind = 'stray'").toArray(),
    );
    expect(strays).toStrictEqual([]);
  });
});

describe("deleting the account from its cell", () => {
  it("runs its steps in order: the tombstone, the agent's conversations, its notes, the cell's storage, its files, its grants, its invite", async () => {
    expect(ACCOUNT_PURGE_STEPS.map((step) => step.name)).toStrictEqual([
      "tombstone",
      "agent",
      "notes",
      "storage",
      "files",
      "grants",
      "invite",
    ]);
    const email = "purge-order@example.test";
    const { cookie } = await signUpUser(email);
    await connectAssistant(cookie);
    const accountId = await userIdOf(cookie);
    const { helpers } = connectorAuth(env);
    const grants = async (): Promise<number> => {
      const listed = await helpers.listUserGrants(accountId);
      return listed.items.length;
    };
    const stranger = newAccountId();
    await env.BLOBS.put(blobKey(accountId, SHA), "mine");
    await env.BLOBS.put(blobKey(stranger, SHA), "theirs");
    const db = createDb(env.DB);
    const invites = async (): Promise<number> => {
      const rows = await db
        .select()
        .from(inviteCode)
        .where(sql`lower(${inviteCode.redeemedBy}) = lower(${email})`)
        .all();
      return rows.length;
    };
    const [invite] = await db
      .select({ code: inviteCode.code })
      .from(inviteCode)
      .where(sql`lower(${inviteCode.redeemedBy}) = lower(${email})`)
      .all();
    // two conversations the account's threads name, each holding rows in its own object
    const threadIds = ["thread-0", "thread-1"];
    for (const threadId of threadIds) {
      await threadOf(accountId, threadId).inspect();
    }
    const heldThreads = async (): Promise<number> => {
      let held = 0;
      for (const threadId of threadIds) {
        held += (await threadHolds(accountId, threadId)) ? 1 : 0;
      }
      return held;
    };
    // what each step left behind, and what a read meeting the cell then heard
    interface Seen {
      readonly alarm: number | null;
      readonly files: number;
      readonly grants: number;
      readonly invites: number;
      readonly items: number;
      readonly read: CellRefusal | null;
      readonly threads: number;
    }
    const seen = new Map<string, Seen>();
    await inCell(cellOf(accountId), async (state) => {
      const cell = cellIn(state, { alarm: "platform" });
      landedValue(
        createItem(cell.library, PERSON, {
          blocks: placed([paragraph("a", "gone with the account")]),
          fields: noteFixture(),
          id: crypto.randomUUID(),
          opId: crypto.randomUUID(),
        }),
      );
      for (const threadId of threadIds) {
        state.storage.sql.exec(
          `INSERT INTO threads (id, title, status, created_at, updated_at)
           VALUES (?, 'A thread', 'idle', 0, 0)`,
          threadId,
        );
      }
      // the write's op answer waits for the prune, so the alarm is set until the tombstone takes it
      await expect(state.storage.getAlarm()).resolves.toStrictEqual(expect.any(Number));
      const scope = { cell, ctx: state, email };
      for (const step of ACCOUNT_PURGE_STEPS) {
        await step.run(scope);
        seen.set(step.name, {
          alarm: await state.storage.getAlarm(),
          files: await files(accountBlobPrefix(accountId)),
          grants: await grants(),
          invites: await invites(),
          items: itemCount(state),
          read: refusalOf(cellIn(state, { clock: clockAt() }).library.read(() => null)),
          threads: await heldThreads(),
        });
      }
    });
    const gone = { kind: "gone" };
    // the tombstone's own commit takes the alarm: no job runs once the deletion began
    const before = { alarm: null, files: 1, grants: 1, invites: 1, items: 1 };
    expect(Object.fromEntries(seen)).toStrictEqual({
      agent: { ...before, read: gone, threads: 0 },
      files: { alarm: null, files: 0, grants: 1, invites: 1, items: 0, read: gone, threads: 0 },
      grants: { alarm: null, files: 0, grants: 0, invites: 1, items: 0, read: gone, threads: 0 },
      invite: { alarm: null, files: 0, grants: 0, invites: 0, items: 0, read: gone, threads: 0 },
      notes: { ...before, read: gone, threads: 0 },
      storage: { alarm: null, files: 1, grants: 1, invites: 1, items: 0, read: gone, threads: 0 },
      tombstone: { ...before, read: gone, threads: 2 },
    });
    // another account's files stay
    await expect(files(accountBlobPrefix(stranger))).resolves.toBe(1);
    // the invite names nobody now, and stays spent
    const spent = await db
      .select({ redeemedAt: inviteCode.redeemedAt })
      .from(inviteCode)
      .where(eq(inviteCode.code, invite?.code ?? ""))
      .get();
    expect(spent?.redeemedAt).not.toBeNull();
  });

  // a thousand and five puts to R2, past one listing's page on purpose
  it(
    "empties the account's files page by page, past one listing's thousand",
    { timeout: 30_000 },
    async () => {
      const accountId = newAccountId();
      const prefix = accountBlobPrefix(accountId);
      for (let index = 0; index < 1005; index += 1) {
        await env.BLOBS.put(blobKey(accountId, index.toString(16).padStart(64, "0")), "x");
      }
      const before = await env.BLOBS.list({ prefix });
      expect(before.truncated).toBe(true);
      const filesStep = ACCOUNT_PURGE_STEPS.find((step) => step.name === "files");
      await inCell(cellOf(accountId), async (state) => {
        await filesStep?.run({
          cell: cellIn(state),
          ctx: state,
          email: "files-paged@example.test",
        });
      });
      await expect(files(prefix)).resolves.toBe(0);
    },
  );

  it("takes out of R2 an upload that took its room before the tombstone and landed after the files went", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    const key = blobKey(accountId, SHA);
    await expect(
      stub.reserveBlob({ bytes: 5, mime: "image/png", sha: SHA }),
    ).resolves.toStrictEqual({ ok: true, value: { held: false } });
    await stub.purge("purge-race@example.test");
    // the upload's bytes reach R2 after the files step listed the account's prefix
    await env.BLOBS.put(key, "bytes", { httpMetadata: { contentType: "image/png" } });
    await expect(stub.settleBlob(SHA)).resolves.toStrictEqual({
      ok: false,
      refusal: { kind: "gone" },
    });
    await expect(env.BLOBS.head(key)).resolves.toBeNull();
  });

  it("keeps no alarm for a job a failed step left behind, once the deletion began", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    await inCell(stub, async (state) => {
      const [tombstone] = ACCOUNT_PURGE_STEPS;
      await tombstone?.run({
        cell: cellIn(state),
        ctx: state,
        email: "never-signed-up@example.test",
      });
      scheduleJob(
        cellDbOf(state.storage),
        { id: "agent-watch:left", kind: "agent-watch", payload: { threadId: "left" } },
        Date.now(),
      );
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    // the alarm's own commits set none again, though the job still waits
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    await inCell(stub, async (state) => {
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });
  });

  it("runs again from the top after a step failed, as Better Auth retries the deletion", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    await inCell(stub, async (state) => {
      const scope = { cell: cellIn(state), ctx: state, email: "never-signed-up@example.test" };
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
      read: refusalOf(cellIn(state, { clock: clockAt() }).library.read(() => null)),
    }));
    expect(after).toStrictEqual({ items: 0, read: { kind: "gone" } });
    await expect(
      stub.reserveBlob({ bytes: 5, mime: "image/png", sha: SHA }),
    ).resolves.toStrictEqual({
      ok: false,
      refusal: { kind: "gone" },
    });
  });
});
