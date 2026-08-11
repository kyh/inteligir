// ---------------------------------------------------------------------------
// The vault inside the UserHost Durable Object, driven against the real
// miniflare substrate: its own SQLite manifest, the real R2 bucket, the real
// alarm.
//
// The assertions worth having are the ones a type cannot make: that a conflict
// is a VALUE, that no manifest row can exist before its bytes, that a case-only
// rename moves nothing, that a tombstone survives and then does not, that the
// deletion gate holds and that a confirmation buys exactly one pass.
// ---------------------------------------------------------------------------

import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { UI_STATE_OPEN_NOTE_KEY } from "@repo/bridge/ui-state";

import { sha256Hex } from "../hash";
import { userHostName } from "../host/host-address";
import { UserKnowledge } from "../host/knowledge/user-knowledge";
import { SEED_OPEN_NOTE, seedVault } from "../host/vault/seed";
import { UserVault, type VaultChange } from "../host/vault/user-vault";
import { renameWithLinkRewrite } from "../host/vault/vault-rename";
import { authenticated, invoke, ORIGIN, signUp, WEB_ORIGIN, type Account } from "./host-helpers";

/** Thirty days, the tombstone retention the sweep enforces. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type VaultContext = {
  vault: UserVault;
  /** The index over that vault, wired exactly as the host wires it — a rename
   * asks it which docs to read, so a fake here would be testing nothing. */
  knowledge: UserKnowledge;
  /** One entry per `onChanged` — the host's broadcast trigger. */
  changes: VaultChange[];
  state: DurableObjectState;
};

/** Drive a bare vault inside a Durable Object, on a name no other test uses so
 * the manifest table is this test's alone. `run` executes inside the object —
 * a `SqlStorage` handle is bound to its I/O context and cannot leave it. */
function withVault<T>(
  name: string,
  run: (ctx: VaultContext) => Promise<T> | T,
  bucketFor: (ctx: { list: () => number }) => R2Bucket = () => env.VAULT_FILES,
): Promise<T> {
  const stub = env.UserHost.getByName(userHostName(name));
  return runInDurableObject(stub, (_host, state) => {
    const changes: VaultChange[] = [];
    let vault: UserVault | null = null;
    let knowledge: UserKnowledge | null = null;
    const bucket = bucketFor({ list: () => vault?.list().length ?? -1 });
    vault = new UserVault({
      sql: state.storage.sql,
      bucket,
      prefix: `test:${name}`,
      onChanged: (change) => {
        changes.push(change);
        knowledge?.record(change);
      },
    });
    knowledge = new UserKnowledge({
      storage: state.storage,
      vault,
      onUpdated: () => {},
      onDeadlineChanged: () => {},
    });
    return run({ vault, knowledge, changes, state });
  });
}

const utf8 = new TextEncoder();

describe("manifest", () => {
  it("round-trips a doc through R2 and the manifest", async () => {
    await withVault("manifest-roundtrip", async ({ vault, changes }) => {
      const written = await vault.write("notes/ideas.md", utf8.encode("# Ideas\n"));
      expect(written).toEqual({ ok: true, file: expect.objectContaining({ version: 1 }) });

      expect(vault.list()).toEqual([{ path: "notes/ideas.md", name: "ideas.md", kind: "doc" }]);
      expect(await vault.readText("notes/ideas.md")).toBe("# Ideas\n");
      expect(vault.fileFacts("notes/ideas.md")).toEqual({
        sizeBytes: 8,
        modifiedMs: expect.any(Number),
      });
      // Every mutation announces itself; nothing else does.
      expect(changes).toHaveLength(1);
      expect(vault.fileFacts("notes/missing.md")).toBeNull();
    });
  });

  it("treats two spellings of one name as one file", async () => {
    await withVault("manifest-case", async ({ vault }) => {
      await vault.writeText("Note.md", "first");
      await vault.writeText("note.md", "second");
      // One row, and the spelling is the one last written — case-preserving,
      // case-insensitive.
      expect(vault.list()).toEqual([{ path: "note.md", name: "note.md", kind: "doc" }]);
      expect(await vault.readText("NOTE.MD")).toBe("second");
    });
  });

  it("announces the spelling a write retired, exactly as a rename does", async () => {
    await withVault("manifest-case-announce", async ({ vault, changes }) => {
      await vault.writeText("Meeting.md", "first");
      changes.length = 0;
      await vault.writeText("meeting.md", "second");
      // The row's display path moved, so the old one is GONE from the listing —
      // and a change that named only the new one would leave every listener
      // (the open editor, the index, the container's workspace) holding a path
      // the manifest no longer has. `move`'s case-only branch says the same.
      expect(changes).toEqual([
        { upserted: [{ path: "meeting.md", body: expect.anything() }], removed: ["Meeting.md"] },
      ]);

      // A write that keeps the spelling retires nothing — the announcement must
      // not claim a deletion an autosave did not cause.
      changes.length = 0;
      await vault.writeText("meeting.md", "third");
      expect(changes).toEqual([
        { upserted: [{ path: "meeting.md", body: expect.anything() }], removed: [] },
      ]);
    });
  });

  it("refuses a path that climbs out of the vault", async () => {
    await withVault("manifest-escape", async ({ vault }) => {
      expect(await vault.write("../escape.md", utf8.encode("x"))).toEqual({
        ok: false,
        reason: "bad-path",
      });
      expect(vault.list()).toEqual([]);
    });
  });

  it("answers a version conflict as a value, never a throw", async () => {
    await withVault("manifest-occ", async ({ vault }) => {
      await vault.writeText("a.md", "one");
      // Conditional write at the version we hold: lands.
      expect(await vault.writeText("a.md", "two", 1)).toMatchObject({ ok: true });
      // The same base version again: the manifest has moved on.
      const stale = await vault.writeText("a.md", "three", 1);
      expect(stale).toEqual({
        ok: false,
        reason: "version-conflict",
        current: expect.objectContaining({ version: 2, state: "live" }),
      });
      // The refusal changed nothing.
      expect(await vault.readText("a.md")).toBe("two");
    });
  });
});

/** The real bucket with `put` intercepted — an R2Bucket for the vault's
 * purposes, which only ever calls these five verbs. */
function interceptPut(onPut: (key: string) => void, fail = false): R2Bucket {
  const real = env.VAULT_FILES;
  return {
    head: (key: string) => real.head(key),
    get: (key: string, options: never) => real.get(key, options),
    put: (key: string, value: never, options: never) => {
      onPut(key);
      return fail ? Promise.reject(new Error("r2 is down")) : real.put(key, value, options);
    },
    delete: (keys: string | string[]) => real.delete(keys),
    list: (options: never) => real.list(options),
  } as unknown as R2Bucket;
}

describe("write ordering", () => {
  it("puts the bytes before the manifest row can name them", async () => {
    // The invariant is one-directional and load-bearing: an interrupted write
    // may leave an orphan blob, never a manifest row pointing at nothing.
    const rowsAtPutTime: number[] = [];
    await withVault(
      "ordering",
      async ({ vault }) => {
        await vault.writeText("first.md", "hello");
        expect(vault.list()).toHaveLength(1);
      },
      (ctx) => interceptPut(() => rowsAtPutTime.push(ctx.list())),
    );
    expect(rowsAtPutTime, "a manifest row existed before its bytes did").toEqual([0]);
  });

  it("commits no manifest row when the bytes cannot be stored", async () => {
    await withVault(
      "ordering-failure",
      async ({ vault }) => {
        await expect(vault.writeText("doomed.md", "hello")).rejects.toThrow(/r2 is down/);
        expect(vault.list()).toEqual([]);
      },
      () => interceptPut(() => {}, true),
    );
  });
});

describe("soft delete", () => {
  it("tombstones a file, keeps its bytes, and restores it", async () => {
    await withVault("trash", async ({ vault }) => {
      await vault.writeText("keep.md", "body");
      expect(await vault.trash(["keep.md"])).toEqual({ ok: true, trashed: ["keep.md"] });

      // Gone from the listing, present as a tombstone, bytes intact.
      expect(vault.list()).toEqual([]);
      expect(vault.listTrash()).toEqual([{ path: "keep.md", deletedAt: expect.any(Number) }]);
      expect(vault.lookup("keep.md")).toMatchObject({ state: "trashed" });
      await expect(vault.readText("keep.md")).rejects.toThrow(/Not found/);

      expect(await vault.restore("keep.md")).toBe(true);
      expect(vault.list()).toHaveLength(1);
      expect(await vault.readText("keep.md")).toBe("body");
      // Restoring what is already live is a no-op, not a resurrection.
      expect(await vault.restore("keep.md")).toBe(false);
    });
  });

  it("reports nothing removed when the path names no live file", async () => {
    await withVault("trash-absent", async ({ vault }) => {
      expect(await vault.trash(["never-existed.md"])).toEqual({ ok: true, trashed: [] });
    });
  });

  it("lets a write take a tombstoned path back", async () => {
    await withVault("trash-overwrite", async ({ vault }) => {
      await vault.writeText("reused.md", "old");
      await vault.trash(["reused.md"]);
      await vault.writeText("reused.md", "new");
      expect(vault.lookup("reused.md")).toMatchObject({ state: "live" });
      expect(vault.listTrash()).toEqual([]);
      expect(await vault.readText("reused.md")).toBe("new");
    });
  });
});

/** Fill a vault with `count` notes — enough that a bulk delete clears the
 * gate's absolute floor of 25. */
async function fill(vault: UserVault, count: number): Promise<string[]> {
  const paths: string[] = [];
  for (let index = 0; index < count; index++) {
    const path = `bulk/note-${index}.md`;
    await vault.writeText(path, `# ${index}\n`);
    paths.push(path);
  }
  return paths;
}

describe("deletion gate", () => {
  it("holds an implausible deletion and applies nothing", async () => {
    await withVault("gate-hold", async ({ vault }) => {
      const paths = await fill(vault, 40);
      const held = await vault.trash(paths.slice(0, 30));
      expect(held).toMatchObject({ ok: false, reason: "held" });
      if (held.ok) throw new Error("expected the gate to hold");
      expect(held.held.deletions).toBe(30);
      expect(held.held.liveCount).toBe(40);
      expect(held.held.limit).toBe(25);
      expect(held.held.sample).toHaveLength(5);
      // A held plan is held WHOLE — not the first 25 of it.
      expect(vault.list()).toHaveLength(40);
    });
  });

  it("lets an ordinary delete through untouched", async () => {
    await withVault("gate-quiet", async ({ vault }) => {
      const paths = await fill(vault, 40);
      expect(await vault.trash(paths.slice(0, 5))).toMatchObject({ ok: true });
      expect(vault.list()).toHaveLength(35);
    });
  });

  it("waives on a confirmation, for exactly one pass", async () => {
    await withVault("gate-confirm", async ({ vault }) => {
      const paths = await fill(vault, 40);
      // The count the user was shown, and only that count.
      expect(await vault.trash(paths.slice(0, 30), 29)).toMatchObject({ ok: false });
      expect(await vault.trash(paths.slice(0, 30), 30)).toMatchObject({ ok: true });
      expect(vault.list()).toHaveLength(10);

      // The waiver was never stored: the very next delete is judged afresh,
      // against a window that now holds the 30 just approved.
      const after = await vault.trash(paths.slice(30, 31));
      expect(after).toMatchObject({ ok: false, reason: "held" });
      if (after.ok) throw new Error("expected the gate to hold again");
      expect(after.held.deletions).toBe(31);
    });
  });

  it("counts a restore back out of the window", async () => {
    await withVault("gate-restore", async ({ vault }) => {
      const paths = await fill(vault, 40);
      await vault.trash(paths.slice(0, 30), 30);
      for (const path of paths.slice(0, 26)) await vault.restore(path);
      // Four tombstones left in the window, so one more delete is ordinary.
      expect(await vault.trash(paths.slice(30, 31))).toMatchObject({ ok: true });
    });
  });
});

describe("rename", () => {
  it("rewrites every link that pointed at the moved note", async () => {
    await withVault("rename-links", async ({ vault, knowledge }) => {
      await vault.writeText("notes/Alpha.md", "# Alpha\n\nSee [[Beta]].\n");
      await vault.writeText("Beta.md", "# Beta\n\nBack to [[Alpha]] and [[Alpha|the start]].\n");

      expect(
        await renameWithLinkRewrite(vault, knowledge, "notes/Alpha.md", "notes/Gamma.md"),
      ).toEqual({
        ok: true,
      });

      // The link retargets; the author's display alias survives verbatim.
      expect(await vault.readText("Beta.md")).toBe(
        "# Beta\n\nBack to [[Gamma]] and [[Gamma|the start]].\n",
      );
      // And the old title is recorded as an alias, so anything the surgery
      // missed still resolves.
      const moved = await vault.readText("notes/Gamma.md");
      expect(moved).toContain("aliases:");
      expect(moved).toContain("Alpha");
      expect(vault.lookup("notes/Alpha.md")).toBeNull();
    });
  });

  it("retitles by case without moving a byte", async () => {
    await withVault("rename-case", async ({ vault, knowledge }) => {
      await vault.writeText("Note.md", "# Note\n");
      const before = await env.VAULT_FILES.list({ prefix: "test:rename-case/" });
      expect(before.objects).toHaveLength(1);

      expect(await renameWithLinkRewrite(vault, knowledge, "Note.md", "note.md")).toEqual({
        ok: true,
      });

      expect(vault.list()).toEqual([{ path: "note.md", name: "note.md", kind: "doc" }]);
      expect(await vault.readText("note.md")).toBe("# Note\n");
      // The folded key never changed, so the blob store still holds exactly one
      // object — the failure mode a case-SENSITIVE key would have produced.
      const after = await env.VAULT_FILES.list({ prefix: "test:rename-case/" });
      expect(after.objects.map((object) => object.key)).toEqual(["test:rename-case/note.md"]);
    });
  });

  it("refuses to clobber a live file and refuses an illegal name", async () => {
    await withVault("rename-refusals", async ({ vault, knowledge }) => {
      await vault.writeText("one.md", "1");
      await vault.writeText("two.md", "2");

      expect(await renameWithLinkRewrite(vault, knowledge, "one.md", "two.md")).toMatchObject({
        ok: false,
      });
      expect(await renameWithLinkRewrite(vault, knowledge, "one.md", "bad:name.md")).toMatchObject({
        ok: false,
      });
      expect(await renameWithLinkRewrite(vault, knowledge, "missing.md", "x.md")).toMatchObject({
        ok: false,
      });
      expect(vault.list()).toHaveLength(2);
    });
  });
});

describe("seeding", () => {
  it("seeds a new vault once and never again", async () => {
    await withVault("seed", async ({ vault }) => {
      expect(await seedVault(vault)).toBe(true);
      const seeded = vault.list().map((entry) => entry.path);
      expect(seeded).toEqual(["AGENTS.md", "Welcome.md", "templates/Meeting notes.md"]);

      // Idempotent: a second call writes nothing.
      expect(await seedVault(vault)).toBe(false);
      expect(vault.list()).toHaveLength(3);

      // And it never overwrites: an edited seed file survives re-seeding.
      await vault.writeText("Welcome.md", "mine now");
      expect(await seedVault(vault)).toBe(false);
      expect(await vault.readText("Welcome.md")).toBe("mine now");

      // A deleted seed file is not handed back — the tombstone still counts.
      await vault.trash(["Welcome.md"]);
      expect(await seedVault(vault)).toBe(false);
      expect(vault.list().map((entry) => entry.path)).not.toContain("Welcome.md");
    });
  });
});

// ---------------------------------------------------------------------------
// The socket-driven half: the handlers, the alarm multiplex, the upload route.
// ---------------------------------------------------------------------------

let owner: Account;
let uploader: Account;

beforeAll(async () => {
  owner = await signUp("vault-owner@example.com");
  uploader = await signUp("vault-uploader@example.com");
});

describe("vault over the bridge", () => {
  it("seeds on first connect and serves the whole first paint in ONE call", async () => {
    const { ws, frames } = await authenticated(owner);
    // The root, the listing, the persisted ui state and the open note's own
    // bytes — one round trip, because three would be three (see WorkspaceBoot).
    const boot = await invoke(ws, frames, 1, "getWorkspaceBoot");
    expect(boot).toMatchObject({ ok: true });
    expect(boot.ok ? boot.result : null).toEqual({
      root: "/Vault",
      entries: [
        { path: "AGENTS.md", name: "AGENTS.md", kind: "doc" },
        { path: "Welcome.md", name: "Welcome.md", kind: "doc" },
        { path: "templates/Meeting notes.md", name: "Meeting notes.md", kind: "doc" },
      ],
      uiState: { [UI_STATE_OPEN_NOTE_KEY]: SEED_OPEN_NOTE },
      // The seed decided which note this lands on, and the bundle already
      // carries its text — the client never asks a second time.
      openNote: { path: SEED_OPEN_NOTE, content: expect.stringContaining("This is your vault") },
    });

    // A write announces itself to every connected client, NAMING what moved so
    // a client re-reads only what it has to.
    ws.send(
      JSON.stringify({
        t: "req",
        id: 2,
        method: "writeVaultFile",
        payload: { path: "notes/new.md", content: "# New\n" },
      }),
    );
    const events: Array<{ method: string; payload: unknown }> = [];
    for (;;) {
      const frame = await frames.next();
      if (frame.t === "evt") {
        events.push({ method: frame.method, payload: frame.payload });
        continue;
      }
      expect(frame).toMatchObject({ t: "res", id: 2, ok: true });
      break;
    }
    expect(events).toEqual([
      {
        method: "onVaultChanged",
        payload: {
          root: "/Vault",
          changed: { upserted: ["notes/new.md"], removed: [] },
        },
      },
    ]);

    // `refreshVault` asserts nothing about the manifest — it re-announces it —
    // so it says so rather than naming paths it did not diff.
    ws.send(JSON.stringify({ t: "req", id: 3, method: "refreshVault" }));
    const refreshed: unknown[] = [];
    for (;;) {
      const frame = await frames.next();
      if (frame.t === "evt") {
        // The previous write's index pass lands somewhere in here.
        if (frame.method === "onVaultChanged") refreshed.push(frame.payload);
        continue;
      }
      expect(frame).toMatchObject({ t: "res", id: 3, ok: true });
      break;
    }
    expect(refreshed).toEqual([{ root: "/Vault", changed: null }]);
    ws.close(1000, "done");
  });

  it("multiplexes the trash sweep onto the auth deadline's alarm", async () => {
    const { ws, frames } = await authenticated(uploader);
    const stub = env.UserHost.getByName(userHostName(uploader.userId));

    // The pending-socket deadline armed at connect. A delete must not clobber
    // it — a Durable Object has exactly one alarm.
    const authDeadline = await runInDurableObject(stub, (_host, state) => state.storage.getAlarm());
    expect(authDeadline).not.toBeNull();

    expect(await invoke(ws, frames, 10, "deleteVaultEntry", { path: "Welcome.md" })).toMatchObject({
      ok: true,
      result: { outcome: "trashed" },
    });
    expect(await runInDurableObject(stub, (_host, state) => state.storage.getAlarm())).toBe(
      authDeadline,
    );

    // When it fires, the alarm comes back for whatever is still due — here the
    // tombstone's retention, thirty days out.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const sweepAt = await runInDurableObject(stub, (_host, state) => state.storage.getAlarm());
    expect(sweepAt).not.toBeNull();
    expect(sweepAt ?? 0).toBeGreaterThan(Date.now() + RETENTION_MS - 60_000);

    // Age the tombstone past retention and let the sweep run for real.
    await runInDurableObject(stub, (_host, state) => {
      state.storage.sql.exec(
        "UPDATE vault_files SET deleted_at = ? WHERE path = ?",
        Date.now() - RETENTION_MS - 1000,
        "Welcome.md",
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (host, state) => {
      expect(host.vault.listTrash()).toEqual([]);
      expect(host.vault.lookup("Welcome.md")).toBeNull();
      // Row first, then blob — both gone by the end of the sweep.
      const key = `${userHostName(uploader.userId)}/welcome.md`;
      expect(await env.VAULT_FILES.head(key)).toBeNull();
      // Nothing left to wake for.
      expect(await state.storage.getAlarm()).toBeNull();
    });
    ws.close(1000, "done");
  });

  it("writes and reads an attachment inline", async () => {
    const { ws, frames } = await authenticated(owner);
    const written = await invoke(ws, frames, 20, "writeVaultAsset", {
      dir: "assets",
      baseName: "paste.png",
      bytesBase64: btoa("png-bytes"),
    });
    expect(written).toMatchObject({ ok: true, result: { path: "assets/paste.png" } });

    const read = await invoke(ws, frames, 21, "readVaultAsset", { path: "assets/paste.png" });
    expect(read).toMatchObject({ ok: true, result: { bytesBase64: btoa("png-bytes") } });

    // A second paste of the same name lands beside it rather than over it.
    const second = await invoke(ws, frames, 22, "writeVaultAsset", {
      dir: "assets",
      baseName: "paste.png",
      bytesBase64: btoa("other-bytes"),
    });
    expect(second).toMatchObject({ result: { path: "assets/paste-1.png" } });
    ws.close(1000, "done");
  });
});

function upload(
  account: Account,
  query: string,
  body: BodyInit,
  origin: string | null = WEB_ORIGIN,
) {
  const headers = new Headers({
    cookie: account.cookie,
    "content-type": "application/octet-stream",
  });
  if (origin !== null) headers.set("origin", origin);
  return SELF.fetch(`${ORIGIN}/v1/host/assets?${query}`, { method: "POST", headers, body });
}

describe("asset upload route", () => {
  it("streams a body into the vault and commits a manifest row", async () => {
    const bytes = new Uint8Array(200_000).fill(7);
    const response = await upload(uploader, "dir=assets&name=big.bin", bytes);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: "assets/big.bin" });

    const stub = env.UserHost.getByName(userHostName(uploader.userId));
    await runInDurableObject(stub, async (host) => {
      expect(host.vault.fileFacts("assets/big.bin")).toEqual({
        sizeBytes: 200_000,
        modifiedMs: expect.any(Number),
      });
      expect(await host.vault.readBytes("assets/big.bin")).toEqual(bytes);
      // The digest was computed FROM the stream as it passed, never taken from
      // the client — a wrong one here would be silently wrong forever.
      expect(host.vault.lookup("assets/big.bin")).toMatchObject({
        state: "live",
        contentHash: await sha256Hex(bytes),
      });
    });
  });

  it("refuses an upload with no credential to address an object with", async () => {
    const anonymous = await SELF.fetch(`${ORIGIN}/v1/host/assets?name=x.bin`, {
      method: "POST",
      headers: { origin: WEB_ORIGIN },
      body: "x",
    });
    expect(anonymous.status).toBe(401);
  });

  it("refuses a foreign origin, and a companion class that may not write assets", async () => {
    expect((await upload(uploader, "name=x.bin", "x", "https://evil.example")).status).toBe(403);

    // A bearer with no browser origin is the COMPANION class, and
    // `writeVaultAsset` is not on its allowlist — the same gate the socket
    // applies, over the other transport.
    const companion = await SELF.fetch(`${ORIGIN}/v1/host/assets?name=x.bin`, {
      method: "POST",
      headers: { authorization: `Bearer ${uploader.token}` },
      body: "x",
    });
    expect(companion.status).toBe(403);
  });
});
