import type { CloudFetch } from "@repo/api/cloud/client";
import { VAULT_API_PATHS, VAULT_FILE_MAX_BYTES } from "@repo/api/cloud/vault/vault-schema";
import { takenIgnoringCase } from "@repo/notes/knowledge/doc-file";
import { describeSyncConflict } from "@repo/notes/sync/conflict-copy";
import { reconcileFile } from "@repo/notes/sync/reconcile-file";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SqlDriver } from "../../lib/sql-driver";
import type { NotesStore } from "../notes-store";
import { blobOid, createFakeVault, FAKE_PHONE_DEVICE, networkOver, requestsOf } from "./fake-vault";
import type { FakeVault, Network } from "./fake-vault";
import { launchPhone, openTempDb, tempDbPath } from "./phone-storage";

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

// a promise the test opens by hand
interface Gate {
  wait: Promise<void>;
  open: () => void;
}

const gate = (): Gate => {
  const opener = { open: (): void => undefined };
  // oxlint-disable-next-line promise/avoid-new -- the resolver is handed to the test, which only a promise can do
  const wait = new Promise<void>((resolve) => {
    opener.open = resolve;
  });
  return {
    open: () => {
      opener.open();
    },
    wait,
  };
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
    await first.write("a.md", "# a\n\nfrom the train\n");
    await first.write("b.md", "# b\n\nfrom the train\n");
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
    await store.write("a.md", "# a\none\n");
    await store.write("a.md", "# a\none\ntwo\n");
    await store.write("a.md", "# a\none\ntwo\nthree\n");
    expect(store.outbox.status.get()).toMatchObject({ unsent: 1 });

    net.online = true;
    await store.drain();
    expect(requestsOf(vault, "commit")).toStrictEqual([`commit put a.md@${blobOid("# a\n")}`]);
    expect(vault.files()["a.md"]).toBe("# a\none\ntwo\nthree\n");
  });

  it("refuses a write the caller never read: an inferred base lets a concurrent edit win", async () => {
    const vault = createFakeVault({ "a.md": "# a\n" });
    const { store } = await phone(vault);
    await expect(store.write("a.md", "# a\nblind\n")).rejects.toThrow(/no base was read/u);
    expect(store.outbox.status.get()).toMatchObject({ unsent: 0 });
  });

  it("merges an edit another device made far from the phone's, and tells the note's watcher", async () => {
    const vault = createFakeVault({ "a.md": note() });
    const { net, store } = await phone(vault);
    await readText(store, "a.md");
    net.online = false;
    await store.write("a.md", note({ 1: "phone 1" }));
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
    await store.write("a.md", mine);
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
    await store.write("a.md", "# a\nkept\n");
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
    await store.write("a.md", note({ 5: "phone 5" }));
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

  it("parks a note the vault refuses for its size, keeping its text, while another note goes on", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const { net, store } = await phone(vault);
    await readText(store, "a.md");
    await readText(store, "b.md");
    net.online = false;
    const huge = `# a\n${"x".repeat(VAULT_FILE_MAX_BYTES)}\n`;
    await store.write("a.md", huge);
    await store.write("b.md", "# b\nsent\n");

    net.online = true;
    await store.drain();

    expect(vault.files()).toStrictEqual({ "a.md": "# a\n", "b.md": "# b\nsent\n" });
    const { parked } = store.outbox.status.get();
    expect(parked).toMatchObject([{ canSaveAsNew: true, paths: ["a.md"] }]);
    expect(parked[0]?.reason).toMatch(/too large/u);
    expect(await readText(store, "a.md")).toBe(huge);

    // a later edit to the parked note waits behind it and never overtakes it
    await store.write("b.md", "# b\nsent\nagain\n");
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
    const asked = gate();
    const released = gate();
    // the listing is taken at the head the request reached, and answered only once released
    const fetch: CloudFetch = async (input, init) => {
      const response = await vault.fetch(input, init);
      const url = new URL(input);
      if (held.tree && url.pathname === VAULT_API_PATHS.tree && !url.searchParams.has("after")) {
        asked.open();
        await released.wait;
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
    await asked.wait;
    await store.write("a.md", "# a\nfrom the phone\n");
    await store.drain();
    expect(vault.files()["a.md"]).toBe("# a\nfrom the phone\n");

    released.open();
    await refreshing;

    expect(await mirroredOid(db, "a.md")).toBe(blobOid("# a\nfrom the phone\n"));
    expect(await readText(store, "a.md")).toBe("# a\nfrom the phone\n");
    expect(await readText(store, "b.md")).toBe("# b\nfrom the mac\n");
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
    expect(store.resolveWiki("renamed")).toBe("renamed.md");
    expect(await store.create("NEW.md", "# twin\n")).toStrictEqual({ kind: "exists" });
  });
});
