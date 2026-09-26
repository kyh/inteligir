import { commentsStorePath, parseSidecar } from "@repo/notes/comments/sidecar-schema";
import type { CommentEntry, CommentSidecar } from "@repo/notes/comments/sidecar-schema";
import { describe, expect, it } from "vitest";
import { createCommentOps } from "../comment-ops";
import type { NotesStore } from "../notes-store";
import { blobOid, createFakeVault, networkOver, requestsOf } from "./fake-vault";
import type { FakeVault, Network } from "./fake-vault";
import { launchPhone, MINTED_NOTE_ID, openTempDb, tempDbPath } from "./phone-storage";

const ID = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
const STORE = commentsStorePath(ID);
const AT = 1_790_000_000;

const PLAN = "---\nid: 9e64c3df-c1e2-4a4d-8c07-91528f422413\n---\nline 1\nline 2\nline 3\n";
const anchoredAt = (text: string, line: string, id: string): string =>
  text.replace(line, `%%i:${id}:start%%${line}%%i:${id}:end%%`);

// the bytes of a store holding these entries, as the desktop and the phone both write it
const storeText = (sidecar: CommentSidecar): string => `${JSON.stringify(sidecar, null, 2)}\n`;

const root = (text: string, at = AT): CommentEntry => ({
  createdAt: at,
  source: "user",
  text,
  updatedAt: at,
});

const phoneOver = async (vault: FakeVault, file: string = tempDbPath()) => {
  const net: Network = { loseApplied: false, online: true };
  const store = launchPhone(networkOver(vault, net), openTempDb(file));
  await store.refresh();
  const comments = createCommentOps({
    now: () => AT,
    randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index),
    store,
  });
  return { comments, net, store };
};

const readText = async (store: NotesStore, path: string): Promise<string> => {
  const read = await store.readNote(path);
  if (!read.ok) {
    throw new Error(`${path}: ${read.message}`);
  }
  return read.content;
};

const entriesOf = (text: string | undefined): CommentSidecar => {
  const parsed = parseSidecar(text ?? "");
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.sidecar;
};

describe("a comment made on the phone", () => {
  it("mints a note without an id one, and lands the note and its entry as one change set", async () => {
    const note = "# Plan\n\nHello there.\n";
    const vault = createFakeVault({ "plan.md": note });
    const { comments, store } = await phoneOver(vault);
    const held = await readText(store, "plan.md");
    const withMarkers = anchoredAt(held, "Hello", "c1");

    const added = await comments.add({
      anchor: { content: withMarkers, expected: held },
      id: "c1",
      path: "plan.md",
      text: "Why here?",
    });
    const minted = `---\nid: ${MINTED_NOTE_ID}\n---\n${withMarkers}`;
    expect(added).toStrictEqual({ kind: "edited", note: minted });
    expect(await readText(store, "plan.md")).toBe(minted);

    await store.drain();
    const minedStore = commentsStorePath(MINTED_NOTE_ID);
    expect(requestsOf(vault, "commit")).toStrictEqual([
      `commit put plan.md@${blobOid(note)},put ${minedStore}@absent`,
    ]);
    expect(vault.files()["plan.md"]).toBe(minted);
    expect(entriesOf(vault.files()[minedStore])).toStrictEqual({ c1: root("Why here?") });
  });

  it("replies and resolves in sets of the store alone, signed as the user", async () => {
    const vault = createFakeVault({
      "plan.md": anchoredAt(PLAN, "line 1", "c1"),
      [STORE]: storeText({ c1: root("Why here?", 1) }),
    });
    const { comments, store } = await phoneOver(vault);

    expect(await comments.reply("plan.md", "c1", "Because.")).toStrictEqual({ kind: "done" });
    expect(await comments.resolve("plan.md", "c1", true)).toStrictEqual({ kind: "done" });
    await store.drain();

    const commits = requestsOf(vault, "commit");
    expect(commits).toHaveLength(2);
    expect(commits.every((commit) => commit.startsWith(`commit put ${STORE}@`))).toBe(true);
    const entries = entriesOf(vault.files()[STORE]);
    const replyId = Object.keys(entries).find((id) => id !== "c1");
    expect(entries).toStrictEqual({
      c1: { ...root("Why here?", 1), resolvedAt: AT, resolvedBy: "user", updatedAt: AT },
      [replyId ?? ""]: {
        ...root("Because."),
        parentId: "c1",
        resolvedAt: AT,
        resolvedBy: "user",
      },
    });
  });

  it("keeps both threads when another device commented on the note meanwhile", async () => {
    const vault = createFakeVault({ "plan.md": PLAN, [STORE]: storeText({}) });
    const { comments, net, store } = await phoneOver(vault);
    net.online = false;
    const phoneNote = anchoredAt(PLAN, "line 1", "c1");
    await comments.add({
      anchor: { content: phoneNote, expected: PLAN },
      id: "c1",
      path: "plan.md",
      text: "From the phone",
    });
    vault.change({
      "plan.md": anchoredAt(PLAN, "line 3", "d1"),
      [STORE]: storeText({ d1: root("From the Mac", 5) }),
    });

    net.online = true;
    await store.drain();

    expect(store.outbox.status.get()).toMatchObject({ conflicts: [], parked: [], unsent: 0 });
    expect(vault.files()["plan.md"]).toBe(
      anchoredAt(anchoredAt(PLAN, "line 1", "c1"), "line 3", "d1"),
    );
    expect(entriesOf(vault.files()[STORE])).toStrictEqual({
      c1: root("From the phone"),
      d1: root("From the Mac", 5),
    });
    expect(await readText(store, "plan.md")).toBe(vault.files()["plan.md"]);
  });

  it("sends the anchored note as it was when only the store moved on", async () => {
    const vault = createFakeVault({
      "plan.md": anchoredAt(PLAN, "line 3", "d1"),
      [STORE]: storeText({ d1: root("From the Mac", 5) }),
    });
    const { comments, net, store } = await phoneOver(vault);
    const held = await readText(store, "plan.md");
    net.online = false;
    await comments.add({
      anchor: { content: anchoredAt(held, "line 1", "c1"), expected: held },
      id: "c1",
      path: "plan.md",
      text: "From the phone",
    });
    vault.change({
      [STORE]: storeText({
        d1: root("From the Mac", 5),
        r1: { ...root("A reply from the Mac", 6), parentId: "d1" },
      }),
    });

    net.online = true;
    await store.drain();

    expect(vault.files()["plan.md"]).toBe(anchoredAt(held, "line 1", "c1"));
    expect(Object.keys(entriesOf(vault.files()[STORE])).toSorted()).toStrictEqual([
      "c1",
      "d1",
      "r1",
    ]);
  });

  it("reads as the note and its store before it is sent, and across a relaunch", async () => {
    const vault = createFakeVault({ "plan.md": PLAN });
    const file = tempDbPath();
    const first = await phoneOver(vault, file);
    first.net.online = false;
    const phoneNote = anchoredAt(PLAN, "line 2", "c1");
    await first.comments.add({
      anchor: { content: phoneNote, expected: PLAN },
      id: "c1",
      path: "plan.md",
      text: "Offline",
    });

    const relaunched = launchPhone(networkOver(vault, first.net), openTempDb(file));
    const read = await relaunched.readNote("plan.md");
    expect(read).toMatchObject({ content: phoneNote, ok: true });
    expect(await relaunched.readComments({ content: phoneNote, path: "plan.md" })).toMatchObject({
      ok: true,
      threads: [{ anchored: true, root: { text: "Offline" }, rootId: "c1" }],
    });

    first.net.online = true;
    await relaunched.drain();
    expect(vault.files()["plan.md"]).toBe(phoneNote);
    expect(Object.keys(entriesOf(vault.files()[STORE]))).toStrictEqual(["c1"]);
  });

  it("hands back what the phone holds when the note moved under the anchor", async () => {
    const vault = createFakeVault({ "plan.md": PLAN });
    const { comments, store } = await phoneOver(vault);
    await readText(store, "plan.md");
    await store.write("plan.md", `${PLAN}line 4\n`);

    expect(
      await comments.add({
        anchor: { content: anchoredAt(PLAN, "line 1", "c1"), expected: PLAN },
        id: "c1",
        path: "plan.md",
        text: "Late",
      }),
    ).toStrictEqual({ current: `${PLAN}line 4\n`, kind: "changed" });
  });

  it("refuses a store it cannot read and a note whose id is not text, writing nothing", async () => {
    const vault = createFakeVault({
      "odd.md": "---\nid: 42\n---\nline 1\n",
      "plan.md": PLAN,
      [STORE]: "{ not json",
    });
    const { comments, store } = await phoneOver(vault);

    expect(await comments.reply("plan.md", "c1", "Hello")).toMatchObject({ kind: "refused" });
    const odd = await readText(store, "odd.md");
    expect(
      await comments.add({
        anchor: { content: anchoredAt(odd, "line 1", "c1"), expected: odd },
        id: "c1",
        path: "odd.md",
        text: "Hello",
      }),
    ).toStrictEqual({
      kind: "refused",
      message: "This note's id isn't text, so it can't take a comment.",
    });
    await store.drain();
    expect(requestsOf(vault, "commit")).toStrictEqual([]);
  });
});
