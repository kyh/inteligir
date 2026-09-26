import { afterEach, describe, expect, it, vi } from "vitest";

import { useAgentRequestActions } from "@repo/editor/agent-request";
import { useCommentSurface } from "@repo/editor/comments/comment-store";
import type { VaultChangedEvent } from "@repo/editor/host-io";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { connectPageBridge } from "../bridge/page-bridge";
import { createPageHost } from "../host/page-host";
import type { PageHost } from "../host/page-host";
import { createFakePhone, PHONE_NONCE } from "./fake-phone";
import type { FakePhone } from "./fake-phone";

const NOTE = "# Note\n\nHello there.\n";

let started: PageHost | null = null;

afterEach(() => {
  started?.stop();
  started = null;
});

const VAULT = { "Note.md": NOTE, "Other.md": "Other.\n" };

const openHost = async (files: Readonly<Record<string, string>> = VAULT) => {
  const phone = createFakePhone(files);
  const connecting = connectPageBridge(phone.transport);
  phone.init();
  const { bridge, init } = await connecting;
  const store = createOpenNoteStore();
  const host = createPageHost({ bridge, path: init.path, store });
  started = host;
  host.start();
  await vi.waitFor(() => {
    expect(store.state().editor.kind).toBe("open");
  });
  return { host, phone, store };
};

const buffer = (store: ReturnType<typeof createOpenNoteStore>): string => {
  const { editor } = store.state();
  return editor.kind === "open" ? editor.content : "";
};

// the frames of each kind a port sent while it ran
const asked = async (phone: FakePhone, run: () => Promise<void>): Promise<string[]> => {
  const before = phone.sent.length;
  await run();
  return phone.sent
    .slice(before)
    .map((frame) => (frame.type === "request" ? frame.kind : frame.type));
};

describe("the page's boot", () => {
  it("lists, reads the note it was opened on and says it is open", async () => {
    const { host, phone, store } = await openHost();

    expect(phone.requests("read").map((frame) => frame.payload)).toEqual([{ path: "Note.md" }]);
    expect(phone.requests("list")).toHaveLength(1);
    expect(phone.events("opened")).toEqual([
      { nonce: PHONE_NONCE, path: "Note.md", type: "opened" },
    ]);
    expect(buffer(store)).toBe(NOTE);
    await vi.waitFor(() => {
      expect(host.io.linkResolver.getState().resolveWikiTarget("Other")).toBe("Other.md");
    });
  });
});

describe("each port is one frame kind, and its answer comes back as the port's own", () => {
  it("reads a note an embed shows", async () => {
    const { host, phone } = await openHost();
    let content = "";
    expect(
      await asked(phone, async () => {
        content = await host.io.readVaultFile({ path: "Other.md" });
      }),
    ).toEqual(["read"]);
    expect(content).toBe("Other.\n");
  });

  it("reads an attachment's bytes as a Blob of the phone's media type", async () => {
    const { host, phone } = await openHost();
    phone.answer = () => ({
      ok: true,
      result: { base64: btoa("png bytes"), mediaType: "image/png" },
    });
    const read = await host.io.readVaultAsset({ path: "assets/a.png" });
    expect(phone.requests("readAsset").map((frame) => frame.payload)).toEqual([
      { path: "assets/a.png" },
    ]);
    if (!read.ok) {
      throw new Error(read.error);
    }
    expect(read.bytes.type).toBe("image/png");
    expect(await read.bytes.text()).toBe("png bytes");
  });

  it("answers a refused attachment read as a failed read, never a throw", async () => {
    const { host } = await openHost();
    expect(await host.io.readVaultAsset({ path: "assets/gone.png" })).toEqual({
      error: "no attachment at assets/gone.png",
      ok: false,
    });
  });

  it("writes a pasted attachment as base64 and answers the path the phone chose", async () => {
    const { host, phone } = await openHost();
    phone.answer = () => ({ ok: true, result: { path: "assets/paste.png" } });
    const written = await host.io.writeVaultAsset({
      baseName: "paste.png",
      file: new Blob(["pixels"], { type: "image/png" }),
    });
    expect(written).toEqual({ path: "assets/paste.png" });
    expect(phone.requests("writeAsset").map((frame) => frame.payload)).toEqual([
      { base64: btoa("pixels"), baseName: "paste.png", mediaType: "image/png" },
    ]);
  });

  it("asks the phone's picker, which writes what it picks", async () => {
    const { host, phone } = await openHost();
    phone.answer = () => ({ ok: true, result: { kind: "picked", path: "assets/photo.jpg" } });
    expect(await host.io.pickImage?.()).toEqual({ kind: "picked", path: "assets/photo.jpg" });
    expect(phone.requests("pickImage")).toHaveLength(1);
  });

  it("creates under the absent guard, with no base", async () => {
    const { host, phone } = await openHost();
    const kinds = await asked(phone, async () => {
      expect(await host.io.actions.createNewFileAt("Ideas", "- one\n")).toEqual({
        kind: "created",
        path: "Ideas.md",
      });
    });
    expect(kinds[0]).toBe("write");
    expect(phone.requests("write").map((frame) => frame.payload)).toEqual([
      { content: "- one\n", guard: { kind: "absent" }, path: "Ideas.md" },
    ]);
    expect(phone.files.get("Ideas.md")).toBe("- one\n");
  });

  // each re-lists after it, since a row moved
  it("removes and renames through the phone", async () => {
    const { host, phone } = await openHost();
    expect(
      await asked(phone, async () => {
        await host.io.actions.renameEntry("Other.md", "Later.md");
      }),
    ).toEqual(["rename", "list"]);
    expect(phone.files.has("Later.md")).toBe(true);

    expect(
      await asked(phone, async () => {
        await host.io.actions.deleteEntry("Later.md");
      }),
    ).toEqual(["remove", "list"]);
    expect(phone.files.has("Later.md")).toBe(false);
  });
});

describe("the open note", () => {
  it("saves an edit against the text it was read as", async () => {
    const { host, phone } = await openHost();
    host.io.actions.editNote("Note.md", `${NOTE}More.\n`);
    expect(await host.io.actions.flush()).toBe(true);

    expect(phone.requests("write").map((frame) => frame.payload)).toEqual([
      { content: `${NOTE}More.\n`, guard: { base: NOTE, kind: "expected" }, path: "Note.md" },
    ]);
    expect(phone.events("editorState")).toEqual([
      { dirty: true, nonce: PHONE_NONCE, saveError: null, type: "editorState" },
      { dirty: false, nonce: PHONE_NONCE, saveError: null, type: "editorState" },
    ]);
  });

  it("merges a save the phone finds changed, lands the merge and says where both wrote", async () => {
    const { host, phone, store } = await openHost({ "Note.md": "one\ntwo\nthree\n" });
    phone.files.set("Note.md", "one\ntwo (theirs)\nthree\nfour\n");
    host.io.actions.editNote("Note.md", "one\ntwo (mine)\nthree\n");
    await host.io.actions.flush();

    const [first, retry] = phone.requests("write");
    expect(first?.payload.guard).toEqual({ base: "one\ntwo\nthree\n", kind: "expected" });
    expect(retry?.payload.guard).toEqual({
      base: "one\ntwo (theirs)\nthree\nfour\n",
      kind: "expected",
    });
    expect(buffer(store)).toBe("one\ntwo (mine)\nthree\nfour\n");
    expect(phone.events("mergeConflict")).toEqual([
      { nonce: PHONE_NONCE, path: "Note.md", type: "mergeConflict" },
    ]);
  });

  it("reloads when the phone says the note changed, and tells the editor's listeners", async () => {
    const { host, phone, store } = await openHost();
    const heard: VaultChangedEvent[] = [];
    host.io.onVaultChanged((event) => {
      heard.push(event);
    });
    const targetsBefore = phone.requests("wikiTargets").length;
    phone.files.set("Note.md", "# Note\n\nChanged on the Mac.\n");
    phone.deliver({
      event: { kind: "content", path: "Note.md" },
      nonce: PHONE_NONCE,
      type: "vaultChanged",
    });

    await vi.waitFor(() => {
      expect(buffer(store)).toBe("# Note\n\nChanged on the Mac.\n");
    });
    expect(heard).toEqual([{ kind: "content", path: "Note.md" }]);
    expect(phone.requests("wikiTargets").length).toBe(targetsBefore + 1);
  });

  it("answers a flush once the edits are written", async () => {
    const { host, phone } = await openHost();
    host.io.actions.editNote("Note.md", `${NOTE}Unsaved.\n`);
    phone.deliver({ id: 7, nonce: PHONE_NONCE, type: "flush" });

    await vi.waitFor(() => {
      expect(phone.events("flushed")).toEqual([
        { id: 7, nonce: PHONE_NONCE, ok: true, type: "flushed" },
      ]);
    });
    expect(phone.files.get("Note.md")).toBe(`${NOTE}Unsaved.\n`);
  });
});

describe("leaving the note", () => {
  it("writes the note, then asks the native stack to open the other one", async () => {
    const { host, phone, store } = await openHost();
    host.io.actions.editNote("Note.md", `${NOTE}Before leaving.\n`);
    host.io.actions.openFile("Other.md");

    await vi.waitFor(() => {
      expect(phone.events("navigate")).toEqual([
        { nonce: PHONE_NONCE, path: "Other.md", type: "navigate" },
      ]);
    });
    expect(phone.files.get("Note.md")).toBe(`${NOTE}Before leaving.\n`);
    expect(store.state().openPath).toBe("Note.md");
  });

  it("opens a note it creates on the native stack too", async () => {
    const { host, phone } = await openHost();
    await host.io.actions.createFile("Someday");
    await vi.waitFor(() => {
      expect(phone.events("navigate").map((frame) => frame.path)).toEqual(["Someday.md"]);
    });
    expect(phone.files.get("Someday.md")).toBe("");
  });
});

describe("what the editor asks the shell for", () => {
  it("reaches the native end: Ask agent, a tag and a comment", async () => {
    const { phone } = await openHost();
    useAgentRequestActions.getState().actions?.askAboutSelection("Hello there.");
    useAgentRequestActions.getState().actions?.showTag("errands");
    useCommentSurface.getState().actions?.open(["c1", "c2"]);

    expect(phone.events("askAgent")).toEqual([
      { nonce: PHONE_NONCE, path: "Note.md", selection: "Hello there.", type: "askAgent" },
    ]);
    expect(phone.events("showTag")).toEqual([
      { nonce: PHONE_NONCE, tag: "errands", type: "showTag" },
    ]);
    expect(phone.events("showComments")).toEqual([
      { ids: ["c1", "c2"], nonce: PHONE_NONCE, type: "showComments" },
    ]);
  });
});

const metaOf = (path: string) => useCommentSurface.getState().meta.get(path);

describe("what the phone tells the page of its comments", () => {
  it("draws the note's ranges by the threads the phone names, and forgets them with the page", async () => {
    const { host, phone } = await openHost();
    phone.deliver({
      knownIds: ["c1", "c2"],
      nonce: PHONE_NONCE,
      path: "Note.md",
      resolvedIds: ["c2"],
      type: "commentMeta",
    });
    expect(metaOf("Note.md")).toEqual({
      knownIds: new Set(["c1", "c2"]),
      resolvedIds: new Set(["c2"]),
    });

    phone.deliver({
      knownIds: ["c1"],
      nonce: PHONE_NONCE,
      path: "Note.md",
      resolvedIds: [],
      type: "commentMeta",
    });
    expect(metaOf("Note.md")?.resolvedIds).toEqual(new Set());

    host.stop();
    started = null;
    expect(metaOf("Note.md")).toBeUndefined();
  });
});

const ANCHORED = "# Note\n\n%%i:c3:start%%Hello%%i:c3:end%% there.\n";

// what the editor's comment surface calls on Save
const create = async (id: string, text: string): Promise<boolean | undefined> =>
  await useCommentSurface.getState().actions?.create(id, text);

describe("a new comment", () => {
  it("rides the save that writes its markers, so the phone lands both as one change set", async () => {
    const { host, phone } = await openHost();
    host.io.actions.editNote("Note.md", ANCHORED);

    expect(await create("c3", "Why here?")).toBe(true);
    expect(phone.requests("write")).toEqual([]);
    expect(phone.requests("addComment").map((frame) => frame.payload)).toEqual([
      { base: NOTE, content: ANCHORED, id: "c3", path: "Note.md", text: "Why here?" },
    ]);
    expect(phone.files.get("Note.md")).toBe(ANCHORED);
  });

  it("merges a note the phone finds changed and carries the comment on the retry", async () => {
    const { host, phone } = await openHost({ "Note.md": "one\n\nHello there.\n" });
    phone.files.set("Note.md", "one\n\nHello there.\n\nfrom the Mac\n");
    host.io.actions.editNote("Note.md", "one\n\n%%i:c3:start%%Hello%%i:c3:end%% there.\n");

    expect(await create("c3", "Why here?")).toBe(true);
    const [first, retry] = phone.requests("addComment").map((frame) => frame.payload);
    expect(first?.base).toBe("one\n\nHello there.\n");
    expect(retry).toEqual({
      base: "one\n\nHello there.\n\nfrom the Mac\n",
      content: "one\n\n%%i:c3:start%%Hello%%i:c3:end%% there.\n\nfrom the Mac\n",
      id: "c3",
      path: "Note.md",
      text: "Why here?",
    });
  });

  it("sends its entry alone when the autosave already wrote its markers, and the next save as a write", async () => {
    const { host, phone } = await openHost();
    host.io.actions.editNote("Note.md", ANCHORED);
    await host.io.actions.flush();

    expect(await create("c3", "Why here?")).toBe(true);
    expect(phone.requests("addComment").map((frame) => frame.payload)).toEqual([
      { base: ANCHORED, content: ANCHORED, id: "c3", path: "Note.md", text: "Why here?" },
    ]);

    host.io.actions.editNote("Note.md", `${ANCHORED}More.\n`);
    await host.io.actions.flush();
    expect(phone.requests("write").map((frame) => frame.payload.content)).toEqual([
      ANCHORED,
      `${ANCHORED}More.\n`,
    ]);
  });

  it("is refused before anything is written on a note whose id is not text", async () => {
    const { host, phone } = await openHost({ "Note.md": "---\nid: 42\n---\nHello there.\n" });
    host.io.actions.editNote(
      "Note.md",
      "---\nid: 42\n---\n%%i:c3:start%%Hello%%i:c3:end%% there.\n",
    );

    expect(await create("c3", "Why here?")).toBe(false);
    expect(phone.requests("addComment")).toEqual([]);
    expect(phone.requests("write")).toEqual([]);
  });

  it("fails when the phone refuses its entry", async () => {
    const { host, phone } = await openHost();
    host.io.actions.editNote("Note.md", ANCHORED);
    await host.io.actions.flush();
    phone.answer = (request) =>
      request.kind === "addComment"
        ? { error: "The comments could not be read.", ok: false }
        : null;

    expect(await create("c3", "Why here?")).toBe(false);
  });
});
