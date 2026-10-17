import { WEB_URL_RULE } from "@repo/notes/items/item-kind";
import { describe, expect, it } from "vitest";
import { createFakeVault, networkOver, requestsOf } from "../../notes/__tests__/fake-vault";
import type { FakeVault, Network } from "../../notes/__tests__/fake-vault";
import { launchPhone } from "../../notes/__tests__/phone-storage";
import { createItemOps } from "../item-ops";

const ID = "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17";
const NOW = new Date(Date.UTC(2026, 9, 17, 9, 12, 30));

const phone = async (vault: FakeVault) => {
  const net: Network = { loseApplied: false, online: true };
  const store = launchPhone(networkOver(vault, net));
  await store.refresh();
  const items = createItemOps({ newId: () => ID, now: () => NOW, store });
  return { items, net, store };
};

const stub = (url: string, note = ""): string =>
  `---\nid: ${ID}\nkind: link\nurl: ${url}\nsaved: 2026-10-17T09:12:30Z\n---\n${note === "" ? "" : `\n${note}\n`}`;

describe("saving a link from the phone", () => {
  it("queues ONE create in Unsorted, named by the share's title, with the tracking cut and the note as its body", async () => {
    const vault = createFakeVault({});
    const { items, net, store } = await phone(vault);
    net.online = false;

    expect(
      await items.saveLink({
        note: "  For Tuesday.  ",
        title: "File over app",
        url: "https://stephango.com/file-over-app?utm_source=share",
      }),
    ).toStrictEqual({ kind: "saved", path: "Unsorted/File over app.md" });
    expect(store.outbox.status.get()).toMatchObject({ unsent: 1 });
    expect(store.heldFiles()).toContainEqual(
      expect.objectContaining({
        item: expect.objectContaining({
          facts: expect.objectContaining({ kind: "link", urlKey: "stephango.com/file-over-app" }),
        }),
        path: "Unsorted/File over app.md",
      }),
    );

    net.online = true;
    await store.drain();
    expect(requestsOf(vault, "commit")).toStrictEqual([
      "commit put Unsorted/File over app.md@absent",
    ]);
    expect(vault.files()).toStrictEqual({
      "Unsorted/File over app.md": stub("https://stephango.com/file-over-app", "For Tuesday."),
    });
  });

  it("names a link with no title by its address, and a video by its host's kind", async () => {
    const vault = createFakeVault({});
    const { items, store } = await phone(vault);
    expect(
      await items.saveLink({ note: null, title: null, url: "https://stephango.com/file-over-app" }),
    ).toStrictEqual({ kind: "saved", path: "Unsorted/stephango.com - file over app.md" });
    expect(
      await items.saveLink({ note: null, title: "  ", url: "https://youtu.be/dQw4w9WgXcQ" }),
    ).toStrictEqual({ kind: "saved", path: "Unsorted/youtu.be - dQw4w9WgXcQ.md" });
    await store.drain();
    expect(vault.files()["Unsorted/youtu.be - dQw4w9WgXcQ.md"]).toContain("kind: video\n");
  });

  it("answers where a link already is, however it was spelled", async () => {
    const vault = createFakeVault({
      "Reading/Kept.md": stub("https://www.stephango.com/file-over-app/"),
    });
    const { items } = await phone(vault);
    expect(
      await items.saveLink({
        note: null,
        title: "Again",
        url: "http://stephango.com/file-over-app?fbclid=x#top",
      }),
    ).toStrictEqual({ kind: "already", path: "Reading/Kept.md" });
  });

  it("steps past a taken name", async () => {
    const vault = createFakeVault({ "Unsorted/File over app.md": "# mine\n" });
    const { items } = await phone(vault);
    expect(
      await items.saveLink({ note: null, title: "File over app", url: "https://example.org/a" }),
    ).toStrictEqual({ kind: "saved", path: "Unsorted/File over app 2.md" });
  });

  it("refuses an address that is not a web link, in the library's words", async () => {
    const { items } = await phone(createFakeVault({}));
    for (const url of [
      "mailto:kai@example.org",
      "file:///etc/passwd",
      "ftp://example.org/archive.zip",
      "notes",
    ]) {
      expect(await items.saveLink({ note: null, title: null, url })).toStrictEqual({
        kind: "refused",
        message: WEB_URL_RULE,
      });
    }
  });
});

describe("saving text from the phone", () => {
  it("saves a link inside the text as that link, the rest its note", async () => {
    const vault = createFakeVault({});
    const { items, store } = await phone(vault);
    expect(
      await items.saveText("Read this before Tuesday: https://stephango.com/file-over-app."),
    ).toStrictEqual({ kind: "saved", path: "Unsorted/stephango.com - file over app.md" });
    await store.drain();
    expect(vault.files()).toStrictEqual({
      "Unsorted/stephango.com - file over app.md": stub(
        "https://stephango.com/file-over-app",
        "Read this before Tuesday:",
      ),
    });
  });

  it("saves any other text as a note in Unsorted named by its first line", async () => {
    const vault = createFakeVault({});
    const { items, store } = await phone(vault);
    expect(
      await items.saveText("\n  Call the printer: ask about A3\nand the deadline  "),
    ).toStrictEqual({
      kind: "saved",
      path: "Unsorted/Call the printer - ask about A3.md",
    });
    await store.drain();
    expect(vault.files()).toStrictEqual({
      "Unsorted/Call the printer - ask about A3.md":
        "---\nsaved: 2026-10-17T09:12:30Z\n---\n\nCall the printer: ask about A3\nand the deadline\n",
    });
  });

  it("refuses an empty save", async () => {
    const { items } = await phone(createFakeVault({}));
    expect(await items.saveText("  \n ")).toMatchObject({ kind: "refused" });
  });
});
