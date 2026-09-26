import { createHash } from "node:crypto";
import { base64FromBytes } from "@repo/api/cloud/bytes";
import type { NativeFrame, RequestPayload } from "@repo/mobile-editor/bridge-protocol";
import { describe, expect, it } from "vitest";
import { createCommentOps } from "../../notes/comment-ops";
import { createFileOps } from "../../notes/file-ops";
import type { PhotoIngest } from "../../notes/photo-ingest";
import { createFakeVault, networkOver } from "../../notes/__tests__/fake-vault";
import type { FakeVault, Network } from "../../notes/__tests__/fake-vault";
import {
  launchPhone,
  MINTED_NOTE_ID,
  openTempDb,
  phonePorts,
} from "../../notes/__tests__/phone-storage";
import { createEditorPorts } from "../editor-ports";
import type { EditorRoute } from "../editor-ports";

type VaultChangedEvent = Extract<NativeFrame, { type: "vaultChanged" }>["event"];

const NONCE = "test-nonce-0123456789";
const ID = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
// unix seconds, when every comment in these cases is made
const AT = 1_790_000_000;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const MEMORY_URI = /^memory:\/\/(?:outbox\/)?(?<name>.+)$/u;

// the phone the page talks to: the notes store over the fake vault, and the ports over it, with
// every native half recorded
const phoneFor = async (vault: FakeVault, options: { picked?: PhotoIngest } = {}) => {
  const net: Network = { loseApplied: false, online: true };
  const ports = phonePorts();
  const store = launchPhone(networkOver(vault, net), openTempDb(), ports);
  await store.refresh();
  const fileOps = createFileOps(store);
  const routes: EditorRoute[] = [];
  const notices: string[] = [];
  const opened: (string | null)[] = [];
  const comments: (readonly string[])[] = [];
  const editor = createEditorPorts({
    comments: createCommentOps({
      now: () => AT,
      randomBytes: (length) => new Uint8Array(length),
      store,
    }),
    fileOps,
    go: (route) => {
      routes.push(route);
    },
    newThreadId: () => "thr_1",
    notify: (title, message) => {
      notices.push(`${title}: ${message}`);
    },
    opened: (path) => {
      opened.push(path);
    },
    pickImage: async () => options.picked ?? { kind: "cancelled" },
    readBase64: async (uri) => {
      const name = MEMORY_URI.exec(uri)?.groups?.name ?? "";
      const bytes = ports.attachments.read(name) ?? (await ports.outboxFiles.read(name));
      return base64FromBytes(bytes);
    },
    revisionOf: async (content) => sha256(content),
    showComments: (ids) => {
      comments.push(ids);
    },
    store,
  });
  const changes: VaultChangedEvent[] = [];
  const stop = editor.watch((event) => {
    changes.push(event);
  });
  const write = async (payload: RequestPayload<"write">) => await editor.requests.write(payload);
  return { changes, comments, editor, fileOps, net, notices, opened, routes, stop, store, write };
};

describe("what the editor page asks of the phone", () => {
  it("lands a write the page computed from what the phone holds, and sends it", async () => {
    const vault = createFakeVault({ "a.md": "# a\n" });
    const { editor, net, store, write } = await phoneFor(vault);
    expect(await editor.requests.read({ path: "a.md" })).toStrictEqual({ content: "# a\n" });
    net.online = false;

    expect(
      await write({
        content: "# a\nmore\n",
        guard: { base: "# a\n", kind: "expected" },
        path: "a.md",
      }),
    ).toStrictEqual({ kind: "written" });
    expect(await editor.requests.read({ path: "a.md" })).toStrictEqual({ content: "# a\nmore\n" });
    expect(vault.files()).toStrictEqual({ "a.md": "# a\n" });

    net.online = true;
    await store.drain();
    expect(vault.files()).toStrictEqual({ "a.md": "# a\nmore\n" });
  });

  it("hands back what a sync landed since the page read, for the page's own merge", async () => {
    const vault = createFakeVault({ "a.md": "# a\n" });
    const { editor, store, write } = await phoneFor(vault);
    await editor.requests.read({ path: "a.md" });
    vault.change({ "a.md": "# a\nfrom the mac\n" });
    await store.refresh();

    expect(
      await write({
        content: "# a\nphone\n",
        guard: { base: "# a\n", kind: "expected" },
        path: "a.md",
      }),
    ).toStrictEqual({ current: "# a\nfrom the mac\n", kind: "changed" });
    expect(vault.files()).toStrictEqual({ "a.md": "# a\nfrom the mac\n" });
  });

  it("answers a note deleted since the page read it as missing, and a create as exists once taken", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const { editor, write } = await phoneFor(vault);
    await editor.requests.read({ path: "a.md" });
    expect(await editor.requests.remove({ path: "a.md" })).toStrictEqual({});

    expect(
      await write({
        content: "# a\nlate\n",
        guard: { base: "# a\n", kind: "expected" },
        path: "a.md",
      }),
    ).toStrictEqual({ kind: "missing" });
    expect(
      await write({ content: "# c\n", guard: { kind: "absent" }, path: "c.md" }),
    ).toStrictEqual({ kind: "written" });
    expect(
      await write({ content: "# b?\n", guard: { kind: "absent" }, path: "B.md" }),
    ).toStrictEqual({ kind: "exists" });
    const listed = await editor.requests.list({});
    expect(listed.paths.toSorted()).toStrictEqual(["b.md", "c.md"]);
  });

  it("renames within the note's folder through the file verbs, and says which links kept the old name", async () => {
    const vault = createFakeVault({ "a.md": "See [[target]].\n", "notes/target.md": "# Target\n" });
    const { editor, notices } = await phoneFor(vault);
    expect(
      await editor.requests.rename({ from: "notes/target.md", to: "notes/Moved.md" }),
    ).toStrictEqual({ ok: true });
    expect(await editor.requests.read({ path: "a.md" })).toStrictEqual({
      content: "See [[Moved]].\n",
    });
    expect(notices).toStrictEqual([]);
    expect(await editor.requests.rename({ from: "notes/Moved.md", to: "Moved.md" })).toStrictEqual({
      error: "A note moves to another folder from your Mac.",
      ok: false,
    });
  });

  it("offers wiki targets with each note's id and aliases, and never a comment store", async () => {
    const vault = createFakeVault({
      [`.inteligir/comments/${ID}.json`]: "{}\n",
      "a.md": `---\nid: ${ID}\naliases:\n  - Alpha\n---\n# a\n`,
      "media/p.png": "png bytes",
    });
    const { editor } = await phoneFor(vault);
    expect(await editor.requests.wikiTargets({})).toStrictEqual({
      targets: [
        { aliases: ["Alpha"], id: ID, path: "a.md", title: "a", type: "doc" },
        { path: "media/p.png", title: "p.png", type: "asset" },
      ],
    });
  });

  it("reads an attachment on demand, a photo the vault has not taken yet included", async () => {
    const vault = createFakeVault({ "media/p.png": "png bytes" });
    const { editor, net } = await phoneFor(vault);
    expect(await editor.requests.readAsset({ path: "media/p.png" })).toStrictEqual({
      base64: base64FromBytes(new TextEncoder().encode("png bytes")),
      mediaType: "image/png",
    });

    net.online = false;
    const { path } = await editor.requests.writeAsset({
      base64: base64FromBytes(new Uint8Array([1, 2, 3])),
      baseName: "photo.jpg",
      mediaType: "image/jpeg",
    });
    expect(path).toBe("assets/photo.jpg");
    expect(await editor.requests.readAsset({ path })).toStrictEqual({
      base64: base64FromBytes(new Uint8Array([1, 2, 3])),
      mediaType: "image/jpeg",
    });
  });

  it("answers the photo picker with the path the photo was kept at", async () => {
    const { editor } = await phoneFor(createFakeVault({}), {
      picked: { kind: "picked", path: "assets/p.jpg" },
    });
    expect(await editor.requests.pickImage({})).toStrictEqual({
      kind: "picked",
      path: "assets/p.jpg",
    });
  });

  it("lands a comment the page anchored with its note as one set, and tells the page of the id the note took", async () => {
    const vault = createFakeVault({ "a.md": "# a\n\nHello there.\n" });
    const { changes, editor, store } = await phoneFor(vault);
    await editor.requests.read({ path: "a.md" });
    const anchored = "# a\n\n%%i:c1:start%%Hello%%i:c1:end%% there.\n";

    expect(
      await editor.requests.addComment({
        base: "# a\n\nHello there.\n",
        content: anchored,
        id: "c1",
        path: "a.md",
        text: "Why here?",
      }),
    ).toStrictEqual({ kind: "written" });
    expect(changes).toContainEqual({ kind: "content", path: "a.md" });

    await store.drain();
    const commentStore = `.inteligir/comments/${MINTED_NOTE_ID}.json`;
    expect(Object.keys(vault.files()).toSorted()).toStrictEqual([commentStore, "a.md"]);
    expect(vault.files()["a.md"]).toBe(`---\nid: ${MINTED_NOTE_ID}\n---\n${anchored}`);
    expect(vault.commits()).toBe(2);
  });

  it("hands a comment's note back for the page's merge when a sync landed since the page read", async () => {
    const vault = createFakeVault({ "a.md": "# a\n" });
    const { editor, store } = await phoneFor(vault);
    await editor.requests.read({ path: "a.md" });
    vault.change({ "a.md": "# a\nfrom the mac\n" });
    await store.refresh();

    expect(
      await editor.requests.addComment({
        base: "# a\n",
        content: "%%i:c1:start%%# a%%i:c1:end%%\n",
        id: "c1",
        path: "a.md",
        text: "Why?",
      }),
    ).toStrictEqual({ current: "# a\nfrom the mac\n", kind: "changed" });
  });
});

describe("what the phone tells the page", () => {
  it("tells a note the page read that changed elsewhere, and never the page's own write", async () => {
    const vault = createFakeVault({ "a.md": "# a\n", "b.md": "# b\n" });
    const { changes, editor, store, write } = await phoneFor(vault);
    await editor.requests.read({ path: "a.md" });

    await write({
      content: "# a\nmine\n",
      guard: { base: "# a\n", kind: "expected" },
      path: "a.md",
    });
    await store.drain();
    expect(changes).toStrictEqual([]);

    vault.change({ "a.md": "# a\nmine\nand the mac's\n", "c.md": "# c\n" });
    await store.refresh();
    expect(changes).toStrictEqual([
      { kind: "files", paths: ["c.md"] },
      { kind: "content", path: "a.md" },
    ]);
  });

  it("re-lists the page when a note's id or aliases change, and stops when the page goes", async () => {
    const vault = createFakeVault({ "a.md": "# a\n" });
    const { changes, stop, store } = await phoneFor(vault);
    vault.change({ "a.md": "---\naliases:\n  - Alpha\n---\n# a\n" });
    await store.refresh();
    expect(changes).toStrictEqual([{ kind: "files", paths: ["a.md"] }]);

    stop();
    vault.change({ "b.md": "# b\n" });
    await store.refresh();
    expect(changes).toHaveLength(1);
  });
});

describe("where the page's events lead", () => {
  it("asks the agent about the note in a new thread, with the selection and the bytes' revision", async () => {
    const { editor, routes } = await phoneFor(createFakeVault({ "a.md": "# a\n" }));
    editor.handle({ nonce: NONCE, path: "a.md", selection: "why this?", type: "askAgent" });
    await expect.poll(() => routes).toHaveLength(1);
    expect(routes).toStrictEqual([
      {
        kind: "thread",
        note: "a.md",
        quote: "why this?",
        revision: sha256("# a\n"),
        threadId: "thr_1",
      },
    ]);
  });

  it("pushes a note the page opened, and never an attachment", async () => {
    const { comments, editor, opened, routes } = await phoneFor(
      createFakeVault({ "a.md": "# a\n" }),
    );
    editor.handle({ nonce: NONCE, path: "b.md", type: "navigate" });
    editor.handle({ nonce: NONCE, path: "media/p.png", type: "navigate" });
    editor.handle({ ids: ["c1"], nonce: NONCE, type: "showComments" });
    editor.handle({ nonce: NONCE, path: null, type: "opened" });
    expect(routes).toStrictEqual([{ kind: "note", path: "b.md" }]);
    expect(comments).toStrictEqual([["c1"]]);
    expect(opened).toStrictEqual([null]);
  });
});
