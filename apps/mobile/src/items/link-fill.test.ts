import { serializeAnnotationStore } from "@repo/notes/annotations/store-schema";
import { linkStubText } from "@repo/notes/items/item-stub";
import type { FillAnswer, FillJob } from "@repo/mobile-editor/bridge-protocol";
import { describe, expect, it } from "vitest";
import type { NotesStore, PendingFill } from "../notes/notes-store";
import { createFakeVault, networkOver, requestsOf } from "../notes/test-support/fake-vault";
import type { FakeVault, Network } from "../notes/test-support/fake-vault";
import { launchPhone } from "../notes/test-support/phone-storage";
import { fillLink } from "./link-fill";
import type { LinkFillPorts } from "./link-fill";
import type { PageFetchResult, PageRequest } from "./page-fetch";

const ID = "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17";
const ITEM = "Unsorted/File over app.md";
const URL_SAVED = "https://stephango.com/file-over-app";
const COVER_URL = "https://stephango.com/cover.jpg";
const NOW = Date.UTC(2026, 9, 17, 9, 12, 33);
const HASH = `3f9a0c2b1d4e5f60${"0".repeat(48)}`;
const COVER = "assets/covers/3f9a0c2b1d4e5f60.jpg";
const ARTICLE =
  "If you want to create digital artifacts that last, they must be files you can control.";

const stub = linkStubText({
  id: ID,
  note: "",
  saved: Date.UTC(2026, 9, 17, 9, 12, 30),
  url: URL_SAVED,
});

const ROW: PendingFill = { attempts: 0, itemId: ID, notBefore: 0, path: ITEM, url: URL_SAVED };

const encoder = new TextEncoder();

// a JPEG's own start and end around bytes of its own
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

const page = (bytes: Uint8Array, mediaType: string, url = URL_SAVED): PageFetchResult => ({
  ok: true,
  page: { bytes, charset: null, declaredBytes: bytes.length, mediaType, truncated: false, url },
});

const READ: FillAnswer = {
  article: ARTICLE,
  facts: {
    author: null,
    description: "Files you can control.",
    images: [COVER_URL],
    lang: "en",
    oembed: null,
    published: null,
    site: "Steph Ango",
    title: "File over app",
  },
  kept: 1,
  kind: "read",
  rung: "rich",
};

const savedStub = async (vault: FakeVault): Promise<{ net: Network; store: NotesStore }> => {
  const net: Network = { loseApplied: false, online: true };
  const store = launchPhone(networkOver(vault, net));
  await store.refresh();
  await store.saveStub(ITEM, stub, { itemId: ID, notBefore: 0, url: URL_SAVED });
  return { net, store };
};

// the phone's fill over its own store, a web the test answers, and a reader that answers READ
const portsOver = (
  store: NotesStore,
  web: Record<string, PageFetchResult>,
  answer: FillAnswer = READ,
) => {
  const asked: PageRequest[] = [];
  const read: FillJob[] = [];
  const ports: LinkFillPorts = {
    fetch: async (request) => {
      asked.push(request);
      return await Promise.resolve(
        web[request.url] ?? { failure: { kind: "unreachable", transient: true }, ok: false },
      );
    },
    now: () => NOW,
    read: async (job) => {
      read.push(job);
      return await Promise.resolve(answer);
    },
    sha256Hex: async () => await Promise.resolve(HASH),
    shrinkCover: async (picture) =>
      await Promise.resolve(
        picture.mediaType === "image/jpeg"
          ? { bytes: picture.bytes, mediaType: "image/jpeg" as const }
          : null,
      ),
    store,
  };
  return { asked, ports, read };
};

const html = encoder.encode("<html><body><p>File over app</p></body></html>");

describe("a link the phone saved, read on the phone", () => {
  it("writes the page's facts, its article and its cover over the stub, as ONE set with the save", async () => {
    const vault = createFakeVault({});
    const { net, store } = await savedStub(vault);
    net.online = false;
    const { ports, read } = portsOver(store, {
      [COVER_URL]: page(JPEG, "image/jpeg", COVER_URL),
      [URL_SAVED]: page(html, "text/html"),
    });

    expect(await fillLink(ports, ROW, true)).toStrictEqual({ kind: "written" });
    expect(read).toMatchObject([{ prefer: "article", url: URL_SAVED }]);
    net.online = true;
    await store.drain();

    expect(requestsOf(vault, "commit")).toStrictEqual([
      `commit put ${COVER}@absent,put ${ITEM}@absent`,
    ]);
    const filled = vault.files()[ITEM] ?? "";
    expect(filled).toContain(`url: ${URL_SAVED}\nsite: Steph Ango\n`);
    expect(filled).toContain("saved: 2026-10-17T09:12:30Z\nfetched: 2026-10-17T09:12:33Z\n");
    expect(filled).toContain("description: Files you can control.\n");
    expect(filled.endsWith(`![](${COVER})\n\n${ARTICLE}\n`)).toBe(true);
    expect(vault.files()[COVER]).toBe(Buffer.from(JPEG).toString("latin1"));
  });

  it("says a page that is gone in the item's own words, and tries an unreachable one again later", async () => {
    const vault = createFakeVault({});
    const { store } = await savedStub(vault);

    const offline = portsOver(store, {});
    expect(await fillLink(offline.ports, ROW, true)).toStrictEqual({ kind: "retry" });
    const untouched = await store.readNote(ITEM);
    expect(untouched).toMatchObject({ content: stub, ok: true });

    const gone = portsOver(store, {
      [URL_SAVED]: {
        failure: { kind: "status", reason: "not found", status: 404, transient: false },
        ok: false,
      },
    });
    expect(await fillLink(gone.ports, ROW, true)).toStrictEqual({ kind: "written" });
    await store.drain();
    expect(vault.files()[ITEM]).toContain("fetch-error: ");
    expect(vault.files()[ITEM]).toContain("fetched: 2026-10-17T09:12:33Z\n");
  });

  it("says a failure a later try might pass once its tries are spent", async () => {
    const vault = createFakeVault({});
    const { store } = await savedStub(vault);
    const { ports } = portsOver(store, {});

    expect(await fillLink(ports, ROW, false)).toStrictEqual({ kind: "written" });
    await store.drain();
    expect(vault.files()[ITEM]).toContain("fetch-error: ");
  });

  it("asks nothing of a cover whose address names private space, from a public page", async () => {
    const vault = createFakeVault({});
    const { store } = await savedStub(vault);
    const privateCover = "http://192.168.1.20/cover.jpg";
    const { asked, ports } = portsOver(
      store,
      {
        [privateCover]: page(JPEG, "image/jpeg", privateCover),
        [URL_SAVED]: page(html, "text/html"),
      },
      { ...READ, facts: { ...READ.facts, images: [privateCover, "http://localhost/c.jpg"] } },
    );

    expect(await fillLink(ports, ROW, true)).toStrictEqual({ kind: "written" });
    expect(asked.map((request) => request.url)).toStrictEqual([URL_SAVED]);
    await store.drain();
    expect(vault.files()[ITEM]?.endsWith(`---\n\n${ARTICLE}\n`)).toBe(true);
  });

  it("places a highlight waiting on the stub in the fill's own write", async () => {
    const store = serializeAnnotationStore({
      a1b2c3d4e5: {
        createdAt: 1,
        quote: "they must be files you can control",
        source: "external",
        text: "",
        updatedAt: 1,
      },
    });
    const vault = createFakeVault({ [`.inteligir/annotations/${ID}.json`]: store, [ITEM]: stub });
    const net: Network = { loseApplied: false, online: true };
    const phone = launchPhone(networkOver(vault, net));
    await phone.refresh();
    const { ports } = portsOver(
      phone,
      { [URL_SAVED]: page(html, "text/html") },
      { ...READ, facts: { ...READ.facts, images: [] } },
    );

    expect(await fillLink(ports, ROW, true)).toStrictEqual({ kind: "written" });
    await phone.drain();
    expect(vault.files()[ITEM]).toContain(
      "%%i:a1b2c3d4e5:start%%they must be files you can control%%i:a1b2c3d4e5:end%%",
    );
  });

  it("makes a link that answered with a PDF that file's item, the original beside it", async () => {
    const vault = createFakeVault({});
    const { store } = await savedStub(vault);
    const pdf = encoder.encode("%PDF-1.7 file over app");
    const { ports, read } = portsOver(store, { [URL_SAVED]: page(pdf, "application/pdf") });

    expect(await fillLink(ports, ROW, true)).toStrictEqual({ kind: "written" });
    expect(read).toStrictEqual([]);
    await store.drain();
    expect(vault.files()["assets/file-over-app.pdf"]).toBe("%PDF-1.7 file over app");
    expect(vault.files()[ITEM]).toContain("kind: pdf\n");
    expect(vault.files()[ITEM]?.endsWith("![](assets/file-over-app.pdf)\n")).toBe(true);
  });

  it("finds a stub that moved by its id, and gives way to another device's read of the page", async () => {
    const vault = createFakeVault({ "Reading/File over app.md": stub });
    const net: Network = { loseApplied: false, online: true };
    const phone = launchPhone(networkOver(vault, net));
    await phone.refresh();
    const { ports } = portsOver(phone, {
      [COVER_URL]: page(JPEG, "image/jpeg", COVER_URL),
      [URL_SAVED]: page(html, "text/html"),
    });

    expect(await fillLink(ports, ROW, true)).toStrictEqual({ kind: "written" });
    await phone.drain();
    expect(vault.files()["Reading/File over app.md"]).toContain("site: Steph Ango\n");

    expect(await fillLink(ports, { ...ROW, path: "Reading/File over app.md" }, true)).toStrictEqual(
      { kind: "dropped" },
    );
  });
});
