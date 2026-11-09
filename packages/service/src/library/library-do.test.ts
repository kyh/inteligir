import { CONNECTOR_PATH } from "@repo/contract/connector";
import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createDb } from "@repo/db/d1/client";
import { inviteCode } from "@repo/db/d1/schema";
import { connectorAuth } from "../connector/connector-auth";
import { signUpUser, userIdOf } from "../test-support/cloud-helpers";
import { connectAssistant } from "../test-support/connector-session";
import {
  blocksOf,
  cellOf,
  clockAt,
  createItem,
  engineIn,
  inCell,
  landedValue,
  newAccountId,
  noteFields,
  paragraph,
  person,
  placed,
  refusalOf,
} from "../test-support/library-cell";
import { threadHolds, threadOf } from "../test-support/agent-turns";
import { ACCOUNT_PURGE_STEPS } from "./account-purge";
import { accountBlobPrefix, blobKey } from "./cell-blobs";
import { FILL_ACTOR } from "./cell-fills";
import { scheduleJob } from "./cell-jobs";
import { openCellLibrary, scheduleAlarm, settleCommit } from "./cell-library";
import type { CellRefusal } from "./cell-refusal";
import { cellStorageOf } from "./cell-storage";
import { cellAccountId } from "./library-cell";
import { PRINCIPAL_HEADER, principalFromHeader, principalHeaderValue } from "./library-principal";
import type { NamedPrincipal } from "./library-principal";
import { V1_LIBRARY_RPC_PATH } from "./library-rpc";

const SHA = "d".repeat(64);

const files = async (prefix: string): Promise<number> => {
  const listing = await env.BLOBS.list({ prefix });
  return listing.objects.length;
};

// a tab's call as the Worker stamps it, for the account named
const principal = (accountId: string): NamedPrincipal => ({
  accountId,
  actor: { door: "page", kind: "session", sessionId: "laptop-1" },
});

const itemCount = (state: DurableObjectState): number =>
  Number(state.storage.sql.exec("SELECT count(*) AS n FROM items").one().n);

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
        createItem(engineIn(state, clockAt()), FILL_ACTOR, {
          blocks: placed([paragraph("a", "mine")]),
          fields: noteFields(),
          id: crypto.randomUUID(),
        }),
      );
    });
    await expect(inCell(mine, itemCount)).resolves.toBe(1);
    await expect(inCell(theirs, itemCount)).resolves.toBe(0);
  });

  it("takes a library call only with a principal of its own account", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    const call = async (headers: Record<string, string>): Promise<number> => {
      const answer = await stub.fetch(`https://cell.test${V1_LIBRARY_RPC_PATH}/items/createNote`, {
        body: JSON.stringify({ json: { markdown: "Who wrote this?" } }),
        headers: { "content-type": "application/json", ...headers },
        method: "POST",
      });
      await answer.arrayBuffer();
      return answer.status;
    };
    await expect(
      call({ [PRINCIPAL_HEADER]: principalHeaderValue(principal(newAccountId())) }),
    ).resolves.toBe(403);
    await expect(call({})).resolves.toBe(403);
    await expect(inCell(stub, itemCount)).resolves.toBe(0);
    // the same call, under its own account's principal, lands
    await expect(
      call({ [PRINCIPAL_HEADER]: principalHeaderValue(principal(accountId)) }),
    ).resolves.toBe(200);
    await expect(inCell(stub, itemCount)).resolves.toBe(1);
  });

  it("takes an app's call only on the wire, and an assistant's only on the connector", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    const assistant: NamedPrincipal = {
      accountId,
      actor: {
        clientId: "client-1",
        clientName: "Claude",
        grantId: "grant-1",
        kind: "assistant",
        scopes: ["library"],
      },
    };
    const status = async (path: string, as: NamedPrincipal): Promise<number> => {
      const answer = await stub.fetch(`https://cell.test${path}`, {
        body: JSON.stringify({ json: { markdown: "Who wrote this?" } }),
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          [PRINCIPAL_HEADER]: principalHeaderValue(as),
        },
        method: "POST",
      });
      await answer.arrayBuffer();
      return answer.status;
    };
    await expect(status(`${V1_LIBRARY_RPC_PATH}/items/createNote`, assistant)).resolves.toBe(403);
    await expect(status(CONNECTOR_PATH, principal(accountId))).resolves.toBe(403);
    await expect(inCell(stub, itemCount)).resolves.toBe(0);
  });

  it("leaves a limit to an assistant's grant, so no device reads as read-only", () => {
    const laptop = principal(newAccountId());
    expect(principalFromHeader(principalHeaderValue(laptop))).toStrictEqual(laptop);
    const scopes = ["library:read"];
    for (const claim of [
      { ...laptop, scopes },
      { ...laptop, actor: { ...laptop.actor, scopes } },
    ]) {
      expect(principalFromHeader(encodeURIComponent(JSON.stringify(claim)))).toBeNull();
    }
  });

  it("seals a quiet set when its alarm runs, and sets the next one for the prune", async () => {
    const stub = cellOf();
    const written = Date.now() - 20_000;
    await inCell(stub, async (state) => {
      const library = engineIn(state, clockAt(written));
      landedValue(
        createItem(library, person(), {
          blocks: placed([paragraph("a", "typed a while ago")]),
          fields: noteFields(),
          id: crypto.randomUUID(),
        }),
      );
      // the job is due; the alarm is held a minute out so the test runs it, not the clock
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const after = await inCell(stub, async (state) => ({
      alarm: await state.storage.getAlarm(),
      sealed: state.storage.sql.exec("SELECT sealed_at FROM change_sets").one().sealed_at,
    }));
    expect(after.sealed).toStrictEqual(expect.any(Number));
    // the prune job, a day after the seal
    expect(after.alarm).toBeGreaterThan(Date.now() + 23 * 60 * 60_000);
  });

  it("loses nothing to an eviction: the rows, the open set and its alarm", async () => {
    const stub = cellOf();
    const itemId = crypto.randomUUID();
    const alarm = await inCell(stub, async (state) => {
      const library = openCellLibrary(state, env);
      const result = createItem(library, person(), {
        blocks: placed([paragraph("a", "before the eviction")]),
        fields: noteFields(),
        id: itemId,
      });
      await settleCommit(state, env, library, result);
      return await state.storage.getAlarm();
    });
    expect(alarm).toStrictEqual(expect.any(Number));
    await evictDurableObject(stub);
    const after = await inCell(stub, async (state) => {
      const library = openCellLibrary(state, env);
      return {
        alarm: await state.storage.getAlarm(),
        body: blocksOf(library, itemId).length,
        open: state.storage.sql
          .exec("SELECT count(*) AS n FROM change_sets WHERE sealed_at IS NULL")
          .one().n,
      };
    });
    expect(after).toStrictEqual({ alarm, body: 1, open: 1 });
  });

  it("wakes started over empty when it applied a migration this build lacks", async () => {
    const stub = cellOf();
    await inCell(stub, (state) => {
      landedValue(
        createItem(engineIn(state, clockAt()), FILL_ACTOR, {
          blocks: placed([paragraph("a", "a later build's")]),
          fields: noteFields(),
          id: crypto.randomUUID(),
        }),
      );
      state.storage.sql.exec(
        "INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES ('', 0, 'later')",
      );
    });
    await evictDurableObject(stub);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(inCell(stub, itemCount)).resolves.toBe(0);
    expect(warned).toHaveBeenCalledWith({
      event: "cell-schema-reset",
      found: expect.objectContaining({ kind: "drizzle" }),
    });
    warned.mockRestore();
  });

  it("holds room for an upload, lands its row once R2 has it, and answers a resend as held", async () => {
    const accountId = newAccountId();
    const stub = cellOf(accountId);
    const request = { bytes: 5, mime: "image/png", sha: SHA };
    await expect(stub.reserveBlob(request)).resolves.toStrictEqual({
      moved: null,
      ok: true,
      value: { held: false },
    });
    await expect(stub.settleBlob(SHA)).resolves.toStrictEqual({
      moved: null,
      ok: true,
      value: { settled: false },
    });
    await stub.reserveBlob(request);
    await env.BLOBS.put(blobKey(accountId, SHA), "bytes", {
      httpMetadata: { contentType: "image/png" },
    });
    await expect(stub.settleBlob(SHA)).resolves.toStrictEqual({
      moved: null,
      ok: true,
      value: { settled: true },
    });
    await expect(stub.reserveBlob(request)).resolves.toStrictEqual({
      moved: null,
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
  it("runs its steps in order: the tombstone, the agent's conversations, the cell's storage, its files, its grants, its invite", async () => {
    expect(ACCOUNT_PURGE_STEPS.map((step) => step.name)).toStrictEqual([
      "tombstone",
      "agent",
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
      landedValue(
        createItem(engineIn(state, clockAt()), FILL_ACTOR, {
          blocks: placed([paragraph("a", "gone with the account")]),
          fields: noteFields(),
          id: crypto.randomUUID(),
        }),
      );
      const library = openCellLibrary(state, env);
      for (const threadId of threadIds) {
        state.storage.sql.exec(
          `INSERT INTO threads (id, title, status, created_at, updated_at, seq)
           VALUES (?, 'A thread', 'idle', 0, 0, 0)`,
          threadId,
        );
      }
      await scheduleAlarm(state, library);
      const scope = { accountId, ctx: state, email, env };
      for (const step of ACCOUNT_PURGE_STEPS) {
        await step.run(scope);
        seen.set(step.name, {
          alarm: await state.storage.getAlarm(),
          files: await files(accountBlobPrefix(accountId)),
          grants: await grants(),
          invites: await invites(),
          items: itemCount(state),
          read: refusalOf(engineIn(state, clockAt()).read(() => null)),
          threads: await heldThreads(),
        });
      }
    });
    const gone = { kind: "gone" };
    const before = { alarm: expect.any(Number), files: 1, grants: 1, invites: 1, items: 1 };
    expect(Object.fromEntries(seen)).toStrictEqual({
      // a thread's purge settles through the cell, which keeps no alarm past the tombstone
      agent: { ...before, alarm: null, read: gone, threads: 0 },
      files: { alarm: null, files: 0, grants: 1, invites: 1, items: 0, read: gone, threads: 0 },
      grants: { alarm: null, files: 0, grants: 0, invites: 1, items: 0, read: gone, threads: 0 },
      invite: { alarm: null, files: 0, grants: 0, invites: 0, items: 0, read: gone, threads: 0 },
      storage: { alarm: null, files: 1, grants: 1, invites: 1, items: 0, read: gone, threads: 0 },
      tombstone: { ...before, read: gone, threads: 2 },
    });
    // another account's files stay
    await expect(files(accountBlobPrefix(stranger))).resolves.toBe(1);
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
        await filesStep?.run({ accountId, ctx: state, email: "files-paged@example.test", env });
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
    ).resolves.toStrictEqual({ moved: null, ok: true, value: { held: false } });
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
        accountId,
        ctx: state,
        email: "never-signed-up@example.test",
        env,
      });
      scheduleJob(
        cellStorageOf(state.storage).db,
        { id: "agent-watch:left", kind: "agent-watch", payload: "{}" },
        Date.now(),
      );
      await state.storage.setAlarm(Date.now() + 60_000);
      await scheduleAlarm(state, openCellLibrary(state, env));
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });
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
      read: refusalOf(engineIn(state, clockAt()).read(() => null)),
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
