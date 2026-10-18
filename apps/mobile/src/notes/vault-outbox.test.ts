import type { CloudFetch } from "@repo/contract/cloud/client";
import {
  VAULT_API_PATHS,
  VAULT_FILE_MAX_BYTES,
  vaultTreeQuerySchema,
} from "@repo/contract/cloud/vault/vault-schema";
import { composeLinkBody } from "@repo/notes/items/item-body";
import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import type { ItemFileFields } from "@repo/notes/items/item-frontmatter";
import { linkStubText } from "@repo/notes/items/item-stub";
import { takenIgnoringCase } from "@repo/notes/knowledge/doc-file";
import { describeSyncConflict } from "@repo/notes/sync/conflict-copy";
import { reconcileFile } from "@repo/notes/sync/reconcile-file";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deferred } from "../test-support/async";
import type { SqlDriver } from "../lib/sql-driver";
import type { NotesStore } from "./notes-store";
import {
  blobOid,
  createFakeVault,
  FAKE_PHONE_DEVICE,
  networkOver,
  requestsOf,
} from "./test-support/fake-vault";
import type { FakeVault, Network } from "./test-support/fake-vault";
import { launchPhone, openTempDb, tempDbPath } from "./test-support/phone-storage";

// ten lines, so an edit on line 1 and one on line 10 are far apart and two on line 5 overlap
const TEN_LINES = Array.from({ length: 10 }, (_, index) => `line ${String(index + 1)}`);
const note = (edits: Record<number, string> = {}): string =>
  `${TEN_LINES.map((line, index) => edits[index + 1] ?? line).join("\n")}\n`;

const phone = async (vault: FakeVault) => {
  const net: Network = { loseApplied: false, online: true };
  const db = openTempDb();
  const store = launchPhone(networkOver(vault, net), db);
  await store.refresh();
  return { db, net, store };
};

const readText = async (store: NotesStore, path: string): Promise<string> => {
  const read = await store.readNote(path);
  if (!read.ok) {
    throw new Error(`${path}: ${read.message}`);
  }
  return read.content;
};

const mirroredOid = async (db: SqlDriver, path: string): Promise<string | null> => {
  const [row] = await db.all("SELECT oid FROM mirror_entries WHERE path = ?", [path]);
  return row === undefined ? null : z.object({ oid: z.string() }).parse(row).oid;
};

describe("the phone's outbox", () => {
  it("keeps offline edits across a relaunch and lands them in order once the vault answers", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const file = tempDbPath();
    const net: Network = { loseApplied: false, online: true };
    const first = launchPhone(networkOver(vault, net), openTempDb(file));
    await first.refresh();
    await readText(first, "a.md");
    await readText(first, "b.md");

    net.online = false;
    await first.write("a.md", "# a\n\nfrom the train\n", { base: "# a\n", kind: "expected" });
    await first.write("b.md", "# b\n\nfrom the train\n", { base: "# b\n", kind: "expected" });
    expect(await first.create("c.md", "# c\n")).toStrictEqual({ kind: "created" });
    await first.drain();
    expect(first.outbox.status.get()).toMatchObject({ unsent: 3 });

    const relaunched = launchPhone(networkOver(vault, net), openTempDb(file));
    expect(await readText(relaunched, "a.md")).toBe("# a\n\nfrom the train\n");
    net.online = true;
    await relaunched.drain();

    expect(requestsOf(vault, "commit")).toStrictEqual([
      `commit put a.md@${blobOid("# a\n")}`,
      `commit put b.md@${blobOid("# b\n")}`,
      "commit put c.md@absent",
    ]);
    expect(vault.files()).toStrictEqual({
      "a.md": "# a\n\nfrom the train\n",
      "b.md": "# b\n\nfrom the train\n",
      "c.md": "# c\n",
    });
    expect(relaunched.outbox.status.get()).toMatchObject({ parked: [], unsent: 0 });
  });

  it("sends three offline saves of one note as ONE write on the first base", async () => {
    const vault = createFakeVault({ "a.md": "# a\n" });
    const { net, store } = await phone(vault);
    await readText(store, "a.md");
    net.online = false;
    await store.write("a.md", "# a\none\n", { base: "# a\n", kind: "expected" });
    await store.write("a.md", "# a\none\ntwo\n", { base: "# a\none\n", kind: "expected" });
    await store.write("a.md", "# a\none\ntwo\nthree\n", {
      base: "# a\none\ntwo\n",
      kind: "expected",
    });
    expect(store.outbox.status.get()).toMatchObject({ unsent: 1 });

    net.online = true;
    await store.drain();
    expect(requestsOf(vault, "commit")).toStrictEqual([`commit put a.md@${blobOid("# a\n")}`]);
    expect(vault.files()["a.md"]).toBe("# a\none\ntwo\nthree\n");
  });

  it("hands back what the phone holds for a write whose base it no longer holds, compared under its write lock", async () => {
    const vault = createFakeVault({ "a.md": "# a\n" });
    const { net, store } = await phone(vault);
    net.online = false;
    // both computed from the same text: the second is compared only once the first is queued
    const [first, second] = await Promise.all([
      store.write("a.md", "# a\nfirst\n", { base: "# a\n", kind: "expected" }),
      store.write("a.md", "# a\nsecond\n", { base: "# a\n", kind: "expected" }),
    ]);
    expect(first).toStrictEqual({ kind: "written" });
    expect(second).toStrictEqual({ current: "# a\nfirst\n", kind: "changed" });
    expect(await readText(store, "a.md")).toBe("# a\nfirst\n");
    expect(store.outbox.status.get()).toMatchObject({ unsent: 1 });
  });

  it("merges an edit another device made far from the phone's, and tells the note's watcher", async () => {
    const vault = createFakeVault({ "a.md": note() });
    const { net, store } = await phone(vault);
    await readText(store, "a.md");
    net.online = false;
    await store.write("a.md", note({ 1: "phone 1" }), { base: note(), kind: "expected" });
    vault.change({ "a.md": note({ 10: "mac 10" }) });
    let told = 0;
    store.watchPath("a.md", () => {
      told += 1;
    });

    net.online = true;
    await store.drain();

    const both = note({ 1: "phone 1", 10: "mac 10" });
    expect(vault.files()["a.md"]).toBe(both);
    expect(requestsOf(vault, "commit")).toStrictEqual([
      `commit put a.md@${blobOid(note())}`,
      `commit put a.md@${blobOid(note({ 10: "mac 10" }))}`,
    ]);
    expect(told).toBe(1);
    expect(await readText(store, "a.md")).toBe(both);
    expect(store.outbox.status.get()).toMatchObject({ conflicts: [], unsent: 0 });
  });

  it("keeps the phone's note and copies the other device's, as reconcileFile names them, in one set", async () => {
    const vault = createFakeVault({ "a.md": note(), "b.md": "# b\n" });
    const { net, store } = await phone(vault);
    await readText(store, "a.md");
    net.online = false;
    const mine = note({ 5: "phone 5" });
    const theirs = note({ 5: "mac 5" });
    await store.write("a.md", mine, { base: note(), kind: "expected" });
    vault.change({ "a.md": theirs });

    net.online = true;
    await store.drain();

    const verdict = reconcileFile({
      base: { kind: "text", text: note() },
      isTaken: takenIgnoringCase(["a.md", "b.md"]),
      mine: { kind: "text", text: mine },
      path: "a.md",
      theirDevice: "Mac",
      theirs: { kind: "text", text: theirs },
      thisDevice: FAKE_PHONE_DEVICE,
    });
    expect(verdict.stays).toStrictEqual({ kind: "mine" });
    expect(verdict.copy?.kind).toBe("text");
    if (verdict.copy?.kind !== "text" || verdict.report === null) {
      throw new Error("the verdict names a text copy and a report");
    }
    expect(vault.files()).toStrictEqual({
      "a.md": mine,
      "b.md": "# b\n",
      [verdict.copy.path]: verdict.copy.text,
    });
    expect(requestsOf(vault, "commit").at(-1)).toBe(
      `commit put a.md@${blobOid(theirs)},put ${verdict.copy.path}@absent`,
    );
    expect(store.outbox.status.get().conflicts).toStrictEqual([
      {
        copyPath: verdict.copy.path,
        id: 1,
        message: describeSyncConflict(verdict.report, { thisDevice: FAKE_PHONE_DEVICE }),
        path: "a.md",
      },
    ]);
    expect(await readText(store, verdict.copy.path)).toBe(verdict.copy.text);
  });

  it("recreates a note another device deleted with the phone's edit, and says it kept it", async () => {
    const vault = createFakeVault({ "a.md": "# a\n" });
    const { net, store } = await phone(vault);
    await readText(store, "a.md");
    net.online = false;
    await store.write("a.md", "# a\nkept\n", { base: "# a\n", kind: "expected" });
    vault.change({ "a.md": null });

    net.online = true;
    await store.drain();

    expect(vault.files()).toStrictEqual({ "a.md": "# a\nkept\n" });
    expect(store.outbox.status.get().conflicts.map((notice) => notice.message)).toStrictEqual([
      describeSyncConflict(
        { deletedDevice: "Mac", keptDevice: FAKE_PHONE_DEVICE, kind: "kept-edit", path: "a.md" },
        { thisDevice: FAKE_PHONE_DEVICE },
      ),
    ]);
  });

  it("drops a delete of a note another device edited, keeping the edit", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const { net, store } = await phone(vault);
    await readText(store, "a.md");
    net.online = false;
    await store.remove("a.md");
    vault.change({ "a.md": "# a\nedited on the mac\n" });

    net.online = true;
    await store.drain();

    expect(vault.files()["a.md"]).toBe("# a\nedited on the mac\n");
    expect(await readText(store, "a.md")).toBe("# a\nedited on the mac\n");
    expect(store.outbox.status.get()).toMatchObject({ unsent: 0 });
    expect(store.outbox.status.get().conflicts).toHaveLength(1);
  });

  it("lands a set whose answer was lost once: no second copy, create or rename", async () => {
    const vault = createFakeVault({ "a.md": note(), "b.md": "# b\n" });
    const { net, store } = await phone(vault);
    await readText(store, "a.md");
    await readText(store, "b.md");
    net.online = false;
    await store.write("a.md", note({ 5: "phone 5" }), { base: note(), kind: "expected" });
    await store.create("c.md", "# c\n");
    // the mac takes the name meanwhile, so the rename settles as a set with a copy too
    expect(await store.rename("b.md", "e.md")).toStrictEqual({ kind: "renamed", skipped: [] });
    vault.change({ "a.md": note({ 5: "mac 5" }), "e.md": "# e from the mac\n" });

    net.online = true;
    net.loseApplied = true;
    for (let drains = 0; drains < 10 && store.outbox.status.get().unsent > 0; drains += 1) {
      await store.drain();
    }
    net.loseApplied = false;

    expect(store.outbox.status.get()).toMatchObject({ unsent: 0 });
    expect(vault.files()).toStrictEqual({
      "a (conflict, Mac).md": note({ 5: "mac 5" }),
      "a.md": note({ 5: "phone 5" }),
      "c.md": "# c\n",
      "e (conflict, Mac).md": "# e from the mac\n",
      "e.md": "# b\n",
    });
    // the seed, the mac's edit, then one commit each for the two settles and the create
    expect(vault.commits()).toBe(5);
    expect(await readText(store, "e.md")).toBe("# b\n");
    expect(store.outbox.status.get().conflicts).toHaveLength(2);
  });

  it("lands an edit made after a set whose answer was lost rebased onto that set, never merged against it", async () => {
    const vault = createFakeVault({ "a.md": "# a\n" });
    const net: Network = { loseApplied: false, online: true };
    // the answer to the set the vault applied is lost, and the phone drops offline with it
    const fetch: CloudFetch = async (input, init) => {
      try {
        return await networkOver(vault, net)(input, init);
      } catch (error) {
        if (net.loseApplied) {
          net.loseApplied = false;
          net.online = false;
        }
        throw error;
      }
    };
    const store = launchPhone(fetch, openTempDb());
    await store.refresh();
    await readText(store, "a.md");
    const sent = "# a\none\ntwo\n";
    net.loseApplied = true;
    await store.write("a.md", sent, { base: "# a\n", kind: "expected" });
    await store.drain();
    expect(vault.files()["a.md"]).toBe(sent);
    expect(net.online).toBe(false);

    await store.write("a.md", "# a\none\n", { base: sent, kind: "expected" });
    net.online = true;
    await store.drain();

    expect(vault.files()).toStrictEqual({ "a.md": "# a\none\n" });
    expect(store.outbox.status.get()).toMatchObject({ conflicts: [], parked: [], unsent: 0 });
    expect(
      requestsOf(vault, "commit").filter((line) => line === `commit put a.md@${blobOid(sent)}`),
    ).toHaveLength(1);
  });

  it("drops the old name of a rename whose note another device deleted first", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const { net, store } = await phone(vault);
    net.online = false;
    expect(await store.rename("b.md", "e.md")).toStrictEqual({ kind: "renamed", skipped: [] });
    vault.change({ "b.md": null });

    net.online = true;
    await store.drain();

    expect(vault.files()).toStrictEqual({ "a.md": "# a\n", "e.md": "# b\n" });
    const tree = store.tree.get();
    expect(tree.state === "ready" ? tree.entries.map((entry) => entry.path) : []).toStrictEqual([
      "a.md",
      "e.md",
    ]);
  });

  it("parks a note the vault refuses for its size, keeping its text, while another note goes on", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const { net, store } = await phone(vault);
    await readText(store, "a.md");
    await readText(store, "b.md");
    net.online = false;
    const huge = `# a\n${"x".repeat(VAULT_FILE_MAX_BYTES)}\n`;
    await store.write("a.md", huge, { base: "# a\n", kind: "expected" });
    await store.write("b.md", "# b\nsent\n", { base: "# b\n", kind: "expected" });

    net.online = true;
    await store.drain();

    expect(vault.files()).toStrictEqual({ "a.md": "# a\n", "b.md": "# b\nsent\n" });
    const { parked } = store.outbox.status.get();
    expect(parked).toMatchObject([{ canSaveAsNew: true, paths: ["a.md"] }]);
    expect(parked[0]?.reason).toMatch(/too large/u);
    expect(await readText(store, "a.md")).toBe(huge);

    // a later edit to the parked note waits behind it and never overtakes it
    await store.write("b.md", "# b\nsent\nagain\n", { base: "# b\nsent\n", kind: "expected" });
    await store.drain();
    expect(vault.files()["b.md"]).toBe("# b\nsent\nagain\n");

    const seq = parked[0]?.seq ?? -1;
    await store.outbox.discard(seq);
    expect(await readText(store, "a.md")).toBe("# a\n");
    expect(store.outbox.status.get()).toMatchObject({ parked: [], unsent: 0 });
  });

  it("keeps a landed row when a refresh that listed the tree before the landing applies after it", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const held = { tree: false };
    const asked = deferred();
    const released = deferred();
    // the listing is taken at the head the request reached, and answered only once released
    const fetch: CloudFetch = async (input, init) => {
      const response = await vault.fetch(input, init);
      const url = new URL(input);
      if (
        held.tree &&
        url.pathname === VAULT_API_PATHS.tree &&
        vaultTreeQuerySchema.parse(JSON.parse(z.string().parse(init?.body))).after === undefined
      ) {
        asked.resolve();
        await released.promise;
      }
      return response;
    };
    const db = openTempDb();
    const store = launchPhone(fetch, db);
    await store.refresh();
    await readText(store, "a.md");

    vault.change({ "b.md": "# b\nfrom the mac\n" });
    held.tree = true;
    const refreshing = store.refresh();
    await asked.promise;
    await store.write("a.md", "# a\nfrom the phone\n", { base: "# a\n", kind: "expected" });
    await store.drain();
    expect(vault.files()["a.md"]).toBe("# a\nfrom the phone\n");

    released.resolve();
    await refreshing;

    expect(await mirroredOid(db, "a.md")).toBe(blobOid("# a\nfrom the phone\n"));
    expect(await readText(store, "a.md")).toBe("# a\nfrom the phone\n");
    expect(await readText(store, "b.md")).toBe("# b\nfrom the mac\n");
  });

  it("takes a listing newer than a landing it disagrees with once a later walk lists it too", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const held = { tree: false };
    const asked = deferred();
    const released = deferred();
    // the first page is taken at the head the vault holds once it is released
    const fetch: CloudFetch = async (input, init) => {
      if (held.tree && new URL(input).pathname === VAULT_API_PATHS.tree) {
        held.tree = false;
        asked.resolve();
        await released.promise;
      }
      return await vault.fetch(input, init);
    };
    const store = launchPhone(fetch, openTempDb());
    await store.refresh();
    await readText(store, "a.md");

    held.tree = true;
    const refreshing = store.refresh();
    await asked.promise;
    await store.write("a.md", "# a\nfrom the phone\n", { base: "# a\n", kind: "expected" });
    await store.drain();
    vault.change({ "a.md": "# a\nfrom the mac\n" });
    released.resolve();
    await refreshing;
    expect(await readText(store, "a.md")).toBe("# a\nfrom the phone\n");

    await store.refresh();

    expect(await readText(store, "a.md")).toBe("# a\nfrom the mac\n");
  });

  it("lists a create, a rename and a delete before the vault holds them", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const { net, store } = await phone(vault);
    net.online = false;
    await store.create("new.md", "# new\n");
    await store.rename("a.md", "renamed.md");
    await store.remove("b.md");

    const tree = store.tree.get();
    expect(tree.state === "ready" ? tree.entries.map((entry) => entry.path) : []).toStrictEqual([
      "new.md",
      "renamed.md",
    ]);
    expect(await readText(store, "renamed.md")).toBe("# a\n");
    expect(await store.create("NEW.md", "# twin\n")).toStrictEqual({ kind: "exists" });
  });

  it("settles a phone's edit of a stub against a Mac's fill of it as ONE set, with no copy and no notice", async () => {
    const item = "Unsorted/File over app.md";
    const fields: ItemFileFields = {
      id: "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
      kind: "link",
      saved: "2026-10-17T09:12:30Z",
      url: "https://stephango.com/file-over-app",
    };
    const stub = linkStubText({
      id: "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
      note: "",
      saved: Date.UTC(2026, 9, 17, 9, 12, 30),
      url: "https://stephango.com/file-over-app",
    });
    const filled = (extra: ItemFileFields, stubNote: string): string =>
      composeItemFile(
        { ...fields, fetched: "2026-10-17T09:12:33Z", site: "Steph Ango", ...extra },
        composeLinkBody({
          article: "File over app is a philosophy.",
          copy: null,
          cover: "assets/covers/3f9a0c2b1d4e5f60.jpg",
          note: stubNote,
        }),
      );
    const vault = createFakeVault({ [item]: stub });
    const { net, store } = await phone(vault);
    await readText(store, item);
    net.online = false;
    const edited = composeItemFile({ ...fields, tags: ["read"] }, "For Tuesday.\n");
    await store.write(item, edited, { base: stub, kind: "expected" });
    vault.change({ [item]: filled({}, "") });

    net.online = true;
    await store.drain();

    const settled = filled({ tags: ["read"] }, "For Tuesday.");
    expect(vault.files()).toStrictEqual({ [item]: settled });
    expect(requestsOf(vault, "commit")).toStrictEqual([
      `commit put ${item}@${blobOid(stub)}`,
      `commit put ${item}@${blobOid(filled({}, ""))}`,
    ]);
    expect(await readText(store, item)).toBe(settled);
    expect(store.outbox.status.get()).toMatchObject({ conflicts: [], parked: [], unsent: 0 });
  });
});
