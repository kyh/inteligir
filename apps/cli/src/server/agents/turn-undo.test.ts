// the turns here commit through the same write set the ACP turn driver opens per turn, over the
// composed server's own engine and vault; only the provider is the test's.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { describe, expect, it } from "vitest";
import { bootThreadHarness } from "../test-support/boot-app";
import type { ThreadHarness } from "../test-support/boot-app";
import { removeEntry } from "../vault/remove-entry";
import { beginAgentTurnWrites } from "./agent-commits";
import type { AgentTurnWrites } from "./agent-commits";
import { undoTurnChanges } from "../threads/turn-undo";
import { awaitThreadStatus, createThread, sendMessage } from "./test-support/agent-test-harness";

const doc = (...lines: string[]): string => `${lines.join("\n")}\n`;

interface OpenTurn {
  threadId: string;
  turnId: string;
  writes: AgentTurnWrites;
}

const startTurn = async (harness: ThreadHarness, threadId: string): Promise<OpenTurn> => {
  const turnId = await sendMessage(harness.client, threadId, "edit my notes");
  const writes = beginAgentTurnWrites({
    git: harness.vault.git,
    notifier: harness.bus,
    threadId,
    turnId,
  });
  await writes.ready;
  return { threadId, turnId, writes };
};

const agentWrites = async (
  harness: ThreadHarness,
  turn: OpenTurn,
  notePath: string,
  content: string,
): Promise<void> => {
  const written = await harness.vault.service.write(notePath, content);
  turn.writes.recordPaths([written.path]);
};

// `inteligir annotation add` from the agent's shell, attributed to its turn as the router does.
const agentAnnotates = async (
  harness: ThreadHarness,
  turn: OpenTurn,
  notePath: string,
  id: string,
): Promise<void> => {
  const added = await harness.composed.context.annotations.add({
    id,
    path: notePath,
    quote: "Friday",
    source: "agent",
    text: "Consider Thursday",
  });
  turn.writes.recordPaths(added.wrote);
};

const anchored = (content: string, id: string, span: string): string =>
  content.replace(span, `%%i:${id}:start%%${span}%%i:${id}:end%%`);

const storeOf = (content: string): string => {
  const id = frontmatterId(content);
  if (id === null) {
    throw new Error("the note carries no id");
  }
  return annotationsStorePath(id);
};

const settle = async (harness: ThreadHarness, turn: OpenTurn): Promise<void> => {
  await turn.writes.finish();
  harness.driver.completeTurn(turn.threadId, turn.turnId, "completed");
  await awaitThreadStatus(harness.client, turn.threadId, "idle");
};

const boot = async (seed: Record<string, string> = {}): Promise<ThreadHarness> => {
  const harness = await bootThreadHarness({ mode: "manual" });
  for (const [notePath, content] of Object.entries(seed)) {
    await harness.vault.service.write(notePath, content);
  }
  await harness.vault.git.commitNow();
  return harness;
};

const THREADED = doc(
  "---",
  "id: note-a",
  "---",
  "# A",
  "",
  "ship on %%i:c1:start%%Friday%%i:c1:end%%",
);

const bootThreaded = async (): Promise<ThreadHarness> => {
  const harness = await boot({ "a.md": THREADED });
  await harness.client.annotations.add({
    id: "c1",
    path: "a.md",
    quote: "the passage",
    text: "Why Friday?",
  });
  await harness.vault.git.commitNow();
  return harness;
};

const onDisk = (harness: ThreadHarness, notePath: string): string | null => {
  const absolute = path.join(harness.vaultDir, notePath);
  return existsSync(absolute) ? readFileSync(absolute, "utf-8") : null;
};

describe("undoing a turn", () => {
  it("reverts every note the turn changed and keeps a line the user added since", async () => {
    const harness = await boot({
      "a.md": doc("# A", "", "first", "", "tail"),
      "b.md": doc("# B", "", "one"),
    });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentWrites(harness, turn, "a.md", doc("# A", "", "second", "", "tail"));
    await agentWrites(harness, turn, "b.md", doc("# B", "", "two"));
    await settle(harness, turn);
    await harness.vault.service.write("a.md", doc("# A", "", "second", "", "tail", "mine"));

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: ["a.md", "b.md"],
    });
    expect(onDisk(harness, "a.md")).toBe(doc("# A", "", "first", "", "tail", "mine"));
    expect(onDisk(harness, "b.md")).toBe(doc("# B", "", "one"));
    const { content } = await harness.vault.service.read("a.md");
    expect(content).toBe(doc("# A", "", "first", "", "tail", "mine"));

    const commits = await harness.vault.git.turnCommits(threadId, 0);
    expect(commits.at(-1)?.trailers).toEqual({
      kind: "undo",
      threadId,
      undoesTurnId: turn.turnId,
    });
    const [latest] = await harness.vault.git.history("b.md", { limit: 1, skip: 0 });
    expect(latest).toMatchObject({ authorName: "inteligir", subject: "vault: undo agent changes" });
    expect(await harness.client.threads.turnChanges({ threadId })).toEqual({
      turns: [
        { items: ["a.md", "b.md"], paths: ["a.md", "b.md"], state: "undone", turnId: turn.turnId },
      ],
    });
  });

  it("keeps a note a write raced, with the racer's bytes on disk", async () => {
    const harness = await boot({ "a.md": doc("# A", "", "first") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentWrites(harness, turn, "a.md", doc("# A", "", "second"));
    await settle(harness, turn);

    const { service } = harness.vault;
    const racer = doc("# A", "", "second", "", "typed while the undo read");
    const outcome = await undoTurnChanges({
      db: harness.db,
      git: harness.vault.git,
      knowledge: harness.composed.context.knowledge,
      notifier: harness.bus,
      service: {
        ...service,
        read: async (notePath) => {
          const read = await service.read(notePath);
          await service.write(notePath, racer);
          return read;
        },
      },
      threadId,
      turnId: turn.turnId,
    });

    expect(outcome).toEqual({
      changes: { kept: [{ path: "a.md", reason: "edited-since" }], reverted: [] },
      kind: "undone",
    });
    expect(onDisk(harness, "a.md")).toBe(racer);
  });

  it("leaves a note a running turn has claimed untouched", async () => {
    const harness = await boot({ "a.md": doc("# A", "", "first") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentWrites(harness, turn, "a.md", doc("# A", "", "second"));
    await settle(harness, turn);

    const other = await startTurn(harness, await createThread(harness.client));
    await agentWrites(harness, other, "a.md", doc("# A", "", "third"));

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [{ path: "a.md", reason: "busy" }],
      reverted: [],
    });
    expect(onDisk(harness, "a.md")).toBe(doc("# A", "", "third"));
    await settle(harness, other);
  });

  it("brings back a note the turn deleted and removes the one it created", async () => {
    const harness = await boot({ "gone.md": doc("# Gone", "", "kept bytes") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await harness.vault.service.remove("gone.md");
    turn.writes.recordPaths(["gone.md"]);
    await agentWrites(harness, turn, "made.md", doc("# Made"));
    await settle(harness, turn);

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: ["gone.md", "made.md"],
    });
    expect(onDisk(harness, "gone.md")).toBe(doc("# Gone", "", "kept bytes"));
    expect(onDisk(harness, "made.md")).toBeNull();
  });

  it("takes back an annotation the turn left: its anchor, its entry and the store it started", async () => {
    const original = doc("# A", "", "ship on Friday");
    const harness = await boot({ "a.md": original });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentAnnotates(harness, turn, "a.md", "a1");
    const { content: withId } = await harness.vault.service.read("a.md");
    await agentWrites(harness, turn, "a.md", anchored(withId, "a1", "Friday"));
    await settle(harness, turn);
    const store = storeOf(withId);

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: ["a.md", store],
    });
    expect(onDisk(harness, "a.md")).toBe(original);
    expect(onDisk(harness, store)).toBeNull();
  });

  it("keeps an annotation answered since, with its answer, and still takes the note back", async () => {
    const harness = await boot({ "a.md": doc("# A", "", "ship on Friday") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentAnnotates(harness, turn, "a.md", "a1");
    const { content: withId } = await harness.vault.service.read("a.md");
    await agentWrites(harness, turn, "a.md", anchored(withId, "a1", "Friday"));
    await settle(harness, turn);
    await harness.client.annotations.reply({
      id: "u1",
      parentId: "a1",
      path: "a.md",
      text: "No, Friday",
    });
    const store = storeOf(withId);

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [{ path: store, reason: "edited-since" }],
      reverted: ["a.md"],
    });
    // the anchor goes with the turn; the id the kept annotation is filed under stays
    expect(onDisk(harness, "a.md")).toBe(withId);
    const { annotations } = await harness.client.annotations.list({ path: "a.md" });
    expect(annotations).toMatchObject([{ id: "a1", replies: [{ id: "u1" }], state: "missing" }]);
    const [latest] = await harness.vault.git.history("a.md", { limit: 1, skip: 0 });
    if (latest === undefined) {
      throw new Error("a.md has no history");
    }
    expect(latest.subject).toBe("vault: undo agent changes");
    expect(await harness.vault.git.revision("a.md", latest.sha)).toBe(withId);
  });

  it("takes back the note the turn wrote on an annotation", async () => {
    const harness = await bootThreaded();
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    const { annotations: before } = await harness.client.annotations.list({ path: "a.md" });
    const edited = await harness.composed.context.annotations.edit({
      id: "c1",
      path: "a.md",
      source: "agent",
      text: "Friday it is.",
    });
    turn.writes.recordPaths(edited.wrote);
    await settle(harness, turn);

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: [annotationsStorePath("note-a")],
    });
    const { annotations } = await harness.client.annotations.list({ path: "a.md" });
    expect(annotations).toEqual(before);
  });

  it("brings back a note the turn deleted with the annotations filed under it", async () => {
    const harness = await bootThreaded();
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    turn.writes.recordPaths(
      await removeEntry(harness.vault.service, "a.md", harness.composed.context.knowledge),
    );
    await settle(harness, turn);

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: ["a.md", annotationsStorePath("note-a")],
    });
    expect(onDisk(harness, "a.md")).toBe(THREADED);
    const { annotations } = await harness.client.annotations.list({ path: "a.md" });
    expect(annotations).toMatchObject([{ id: "c1", state: "anchored" }]);
  });

  it("refuses a turn already undone, a turn still running and one it holds no change of", async () => {
    const harness = await boot({ "a.md": doc("# A", "", "first") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentWrites(harness, turn, "a.md", doc("# A", "", "second"));
    await settle(harness, turn);
    await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId });

    const [again] = await safe(harness.client.threads.undoTurn({ threadId, turnId: turn.turnId }));
    expect(isDefinedError(again) && again.code).toBe("CONFLICT");

    const running = await startTurn(harness, threadId);
    await agentWrites(harness, running, "a.md", doc("# A", "", "third"));
    const [live] = await safe(
      harness.client.threads.undoTurn({ threadId, turnId: running.turnId }),
    );
    expect(isDefinedError(live) && live.code).toBe("CONFLICT");
    await settle(harness, running);

    const quiet = await startTurn(harness, threadId);
    await settle(harness, quiet);
    const [unrecorded] = await safe(
      harness.client.threads.undoTurn({ threadId, turnId: quiet.turnId }),
    );
    expect(isDefinedError(unrecorded) && unrecorded.code).toBe("NOT_FOUND");

    const [noThread] = await safe(
      harness.client.threads.undoTurn({ threadId: "thr_missing", turnId: turn.turnId }),
    );
    expect(isDefinedError(noThread) && noThread.code).toBe("NOT_FOUND");
  });
});

// not text: the png signature, a nul and the bytes a utf-8 decode would replace
const pngBytes = (mark: number): Uint8Array =>
  new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0xff, 0xfe, mark]);

const writeFileBytes = async (
  harness: ThreadHarness,
  filePath: string,
  bytes: Uint8Array,
): Promise<void> => {
  const absolute = path.join(harness.vaultDir, filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
};

// a cover as a save keeps one, through the vault, which tells the index the file is there, so an
// embed of it resolves. one written past the vault reaches the index only through the watcher,
// which no suite here runs, or a reconcile, which the boot's own write may have run already.
const saveCover = async (
  harness: ThreadHarness,
  coverPath: string,
  bytes: Uint8Array,
): Promise<void> => {
  const written = await harness.vault.service.writeAsset(
    path.posix.dirname(coverPath),
    path.posix.basename(coverPath),
    bytes,
  );
  expect(written.path).toBe(coverPath);
};

const bytesOnDisk = (harness: ThreadHarness, filePath: string): Uint8Array | null => {
  const absolute = path.join(harness.vaultDir, filePath);
  return existsSync(absolute) ? new Uint8Array(readFileSync(absolute)) : null;
};

describe("undoing a turn's files", () => {
  it("takes back a PNG the turn created, byte-exact", async () => {
    const harness = await boot({ "a.md": doc("# A") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await writeFileBytes(harness, "assets/shot.png", pngBytes(1));
    turn.writes.recordPaths(["assets/shot.png"]);
    await settle(harness, turn);

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: ["assets/shot.png"],
    });
    expect(bytesOnDisk(harness, "assets/shot.png")).toBeNull();
  });

  it("puts back a PNG the turn overwrote and one it deleted, byte-exact", async () => {
    const harness = await boot({ "a.md": doc("# A") });
    await writeFileBytes(harness, "assets/kept.png", pngBytes(1));
    await writeFileBytes(harness, "assets/gone.png", pngBytes(2));
    await harness.vault.git.commitNow();
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await writeFileBytes(harness, "assets/kept.png", pngBytes(9));
    await harness.vault.service.remove("assets/gone.png");
    turn.writes.recordPaths(["assets/kept.png", "assets/gone.png"]);
    await settle(harness, turn);

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: ["assets/gone.png", "assets/kept.png"],
    });
    expect(bytesOnDisk(harness, "assets/kept.png")).toEqual(pngBytes(1));
    expect(bytesOnDisk(harness, "assets/gone.png")).toEqual(pngBytes(2));
  });

  it("keeps a cover the turn added that an item saved since embeds, and takes back its own item", async () => {
    const harness = await boot({ "a.md": doc("# A") });
    const cover = "assets/covers/0123456789abcdef.png";
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await saveCover(harness, cover, pngBytes(4));
    await agentWrites(harness, turn, "Unsorted/Agent's.md", doc(`![](${cover})`, "", "theirs"));
    turn.writes.recordPaths([cover]);
    await settle(harness, turn);
    // the person's own save of another page from the same site: the same cover, by its hash
    await harness.vault.service.write("Unsorted/Mine.md", doc(`![](${cover})`, "", "mine"));
    await harness.composed.context.knowledge.settle();

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [{ path: cover, reason: "linked-since" }],
      reverted: ["Unsorted/Agent's.md"],
    });
    expect(bytesOnDisk(harness, cover)).toEqual(pngBytes(4));
    expect(onDisk(harness, "Unsorted/Agent's.md")).toBeNull();
  });

  it("takes back a cover only the turn's own item embedded", async () => {
    const harness = await boot({ "a.md": doc("# A") });
    const cover = "assets/covers/fedcba9876543210.png";
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await saveCover(harness, cover, pngBytes(5));
    await agentWrites(harness, turn, "Unsorted/Agent's.md", doc(`![](${cover})`, "", "theirs"));
    turn.writes.recordPaths([cover]);
    await settle(harness, turn);
    await harness.composed.context.knowledge.settle();

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: ["Unsorted/Agent's.md", cover],
    });
    expect(bytesOnDisk(harness, cover)).toBeNull();
  });

  it("keeps a file changed since the turn, and never merges its bytes", async () => {
    const harness = await boot({ "a.md": doc("# A") });
    await writeFileBytes(harness, "assets/shot.png", pngBytes(1));
    await harness.vault.git.commitNow();
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await writeFileBytes(harness, "assets/shot.png", pngBytes(2));
    turn.writes.recordPaths(["assets/shot.png"]);
    await settle(harness, turn);
    await writeFileBytes(harness, "assets/shot.png", pngBytes(3));

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [{ path: "assets/shot.png", reason: "edited-since" }],
      reverted: [],
    });
    expect(bytesOnDisk(harness, "assets/shot.png")).toEqual(pngBytes(3));
  });
});
