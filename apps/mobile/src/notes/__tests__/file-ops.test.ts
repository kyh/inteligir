import { VAULT_ASSET_MAX_BYTES } from "@repo/api/cloud/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { createFileOps } from "../file-ops";
import type { NotesStore } from "../notes-store";
import { photoBaseName, photoResize } from "../photo-plan";
import { blobOid, createFakeVault, networkOver, requestsOf } from "./fake-vault";
import type { FakeVault, Network } from "./fake-vault";
import { launchPhone } from "./phone-storage";

const ID = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
const STORE = `.inteligir/comments/${ID}.json`;
const WITH_ID = `---\nid: ${ID}\n---\n# Plan\n`;
const COMMENTS = '{"c1":{"createdAt":1,"source":"user","text":"why?","updatedAt":1}}\n';

const phone = async (vault: FakeVault) => {
  const net: Network = { loseApplied: false, online: true };
  const store = launchPhone(networkOver(vault, net));
  await store.refresh();
  return { fileOps: createFileOps(store), net, store };
};

const readText = async (store: NotesStore, path: string): Promise<string> => {
  const read = await store.readNote(path);
  if (!read.ok) {
    throw new Error(`${path}: ${read.message}`);
  }
  return read.content;
};

describe("renaming a note on the phone", () => {
  it("rewrites a backlink and records the old name as an alias, in one set", async () => {
    const vault = createFakeVault({
      "a.md": "Links to [[target]] today.\n",
      "b.md": "See [details](notes/target.md) for more.\n",
      "notes/target.md": "# Target\n",
      "unrelated.md": "No links, though target is a word here.\n",
    });
    const { fileOps, store } = await phone(vault);

    expect(await fileOps.rename("notes/target.md", "Moved")).toStrictEqual({
      kind: "renamed",
      path: "notes/Moved.md",
      unlinked: [],
    });
    await store.drain();

    const moved = "---\naliases:\n  - target\n---\n# Target\n";
    expect(requestsOf(vault, "commit")).toStrictEqual([
      `commit delete notes/target.md@${blobOid("# Target\n")},put notes/Moved.md@absent,` +
        `put a.md@${blobOid("Links to [[target]] today.\n")},` +
        `put b.md@${blobOid("See [details](notes/target.md) for more.\n")}`,
    ]);
    expect(vault.files()).toStrictEqual({
      "a.md": "Links to [[Moved]] today.\n",
      "b.md": "See [details](notes/Moved.md) for more.\n",
      "notes/Moved.md": moved,
      "unrelated.md": "No links, though target is a word here.\n",
    });
    expect(await readText(store, "notes/Moved.md")).toBe(moved);
    expect(store.resolveWiki("target")).toBe("notes/Moved.md");
  });

  it("moves a note no link names and whose name keeps its stem as it is", async () => {
    const vault = createFakeVault({ "a/plan.md": "# Plan\n" });
    const { fileOps, store } = await phone(vault);
    const moved = await fileOps.rename("a/plan.md", "Plan");
    expect(moved).toMatchObject({ kind: "renamed", path: "a/Plan.md" });
    await store.drain();
    expect(requestsOf(vault, "commit")).toStrictEqual([
      `commit move a/plan.md>a/Plan.md@${blobOid("# Plan\n")}`,
    ]);
  });

  it("keeps the bytes of a note another device changed first, and names it", async () => {
    const vault = createFakeVault({
      "a.md": "Links to [[target]] today.\n",
      "b.md": "Also [[target]].\n",
      "target.md": "# Target\n",
    });
    const { fileOps, net, store } = await phone(vault);
    net.online = false;
    await fileOps.rename("target.md", "Moved");
    const edited = "Links to [[target]] today, edited on the Mac.\n";
    vault.change({ "a.md": edited });

    net.online = true;
    await store.drain();

    expect(vault.files()).toStrictEqual({
      "a.md": edited,
      "b.md": "Also [[Moved]].\n",
      "Moved.md": "---\naliases:\n  - target\n---\n# Target\n",
    });
    const { conflicts, unsent } = store.outbox.status.get();
    expect(unsent).toBe(0);
    expect(conflicts).toMatchObject([{ copyPath: null, path: "a.md" }]);
    expect(store.resolveWiki("target")).toBe("Moved.md");
  });

  it("leaves out a note the phone changed since the rename was planned, and names it", async () => {
    const vault = createFakeVault({ "a.md": "Links to [[target]].\n", "target.md": "# Target\n" });
    const { store } = await phone(vault);
    await readText(store, "a.md");
    await store.write("a.md", "Links to [[target]], and more.\n");

    const outcome = await store.rename("target.md", "Moved.md", {
      note: null,
      rewrites: [
        { content: "Links to [[Moved]].\n", expected: "Links to [[target]].\n", path: "a.md" },
      ],
    });
    expect(outcome).toStrictEqual({ kind: "renamed", skipped: ["a.md"] });
    await store.drain();
    expect(vault.files()["a.md"]).toBe("Links to [[target]], and more.\n");
  });

  it("carries the alias onto the note another device edited first", async () => {
    const vault = createFakeVault({ "target.md": "# Target\n\nfirst line\n" });
    const { fileOps, net, store } = await phone(vault);
    net.online = false;
    await fileOps.rename("target.md", "Moved");
    vault.change({ "target.md": "# Target\n\nfirst line, from the Mac\n" });

    net.online = true;
    await store.drain();

    expect(vault.files()).toStrictEqual({
      "Moved.md": "---\naliases:\n  - target\n---\n# Target\n\nfirst line, from the Mac\n",
    });
  });

  it("refuses a name no note may carry rather than cleaning it", async () => {
    const vault = createFakeVault({ "plan.md": "# Plan\n" });
    const { fileOps } = await phone(vault);
    expect(await fileOps.rename("plan.md", "a/b")).toStrictEqual({
      kind: "refused",
      message: "Note names can't contain / or \\.",
    });
    expect(await fileOps.rename("plan.md", "[draft]")).toMatchObject({ kind: "refused" });
    expect(requestsOf(vault, "commit")).toStrictEqual([]);
  });
});

describe("deleting a note on the phone", () => {
  it("takes its comment store in the same set", async () => {
    const vault = createFakeVault({
      "other.md": "# Other\n",
      "plan.md": WITH_ID,
      [STORE]: COMMENTS,
    });
    const { fileOps, store } = await phone(vault);
    await fileOps.remove("plan.md");
    await store.drain();
    expect(requestsOf(vault, "commit")).toStrictEqual([
      `commit delete plan.md@${blobOid(WITH_ID)},delete ${STORE}@${blobOid(COMMENTS)}`,
    ]);
    expect(vault.files()).toStrictEqual({ "other.md": "# Other\n" });
  });

  it("keeps the store while another note carries the id", async () => {
    const vault = createFakeVault({ "copy.md": WITH_ID, "plan.md": WITH_ID, [STORE]: COMMENTS });
    const { fileOps, store } = await phone(vault);
    await fileOps.remove("plan.md");
    await store.drain();
    expect(vault.files()).toStrictEqual({ "copy.md": WITH_ID, [STORE]: COMMENTS });
  });

  it("keeps the note and its store when another device edited the note first", async () => {
    const vault = createFakeVault({ "plan.md": WITH_ID, [STORE]: COMMENTS });
    const { fileOps, net, store } = await phone(vault);
    net.online = false;
    await fileOps.remove("plan.md");
    const edited = `${WITH_ID}\nEdited on the Mac.\n`;
    vault.change({ "plan.md": edited });

    net.online = true;
    await store.drain();
    expect(vault.files()).toStrictEqual({ "plan.md": edited, [STORE]: COMMENTS });
  });
});

describe("a new note on the phone", () => {
  it("steps past an Untitled that is taken", async () => {
    const vault = createFakeVault({ "notes/Untitled.md": "" });
    const { fileOps, store } = await phone(vault);
    expect(await fileOps.create("notes")).toStrictEqual({
      kind: "created",
      path: "notes/Untitled 2.md",
    });
    expect(await fileOps.create("")).toStrictEqual({ kind: "created", path: "Untitled.md" });
    await store.drain();
    expect(Object.keys(vault.files()).toSorted()).toStrictEqual([
      "Untitled.md",
      "notes/Untitled 2.md",
      "notes/Untitled.md",
    ]);
  });
});

describe("a photo from the phone", () => {
  it("lands in the attachments folder under a free name", async () => {
    const vault = createFakeVault({ "assets/Photo 2026-09-26 14.30.05.jpg": "earlier" });
    const { fileOps, store } = await phone(vault);
    const name = photoBaseName(new Date(2026, 8, 26, 14, 30, 5));
    expect(name).toBe("Photo 2026-09-26 14.30.05.jpg");
    expect(await fileOps.writeAsset(name, new Uint8Array([0xff, 0xd8, 0xff]))).toStrictEqual({
      kind: "written",
      path: "assets/Photo 2026-09-26 14.30.05-2.jpg",
    });
    await store.drain();
    expect(requestsOf(vault, "commit")).toStrictEqual([
      "commit put assets/Photo 2026-09-26 14.30.05-2.jpg@absent",
    ]);
  });

  it("refuses one over the vault's cap before anything is written", async () => {
    const vault = createFakeVault({});
    const { fileOps, store } = await phone(vault);
    expect(
      await fileOps.writeAsset("Photo.jpg", new Uint8Array(VAULT_ASSET_MAX_BYTES + 1)),
    ).toMatchObject({ kind: "refused" });
    expect(store.outbox.status.get()).toMatchObject({ unsent: 0 });
    expect(store.heldFiles()).toStrictEqual([]);
    expect(requestsOf(vault, "commit")).toStrictEqual([]);
  });

  it("is scaled to a 2048px long edge, and one that fits is left as it is", () => {
    expect(photoResize(4032, 3024)).toStrictEqual({ height: 1536, width: 2048 });
    expect(photoResize(3024, 4032)).toStrictEqual({ height: 2048, width: 1536 });
    expect(photoResize(1200, 900)).toBeNull();
    expect(photoResize(2048, 1536)).toBeNull();
  });
});
