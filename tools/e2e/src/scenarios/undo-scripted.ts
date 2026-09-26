import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, expectEq } from "../harness/assert";
import type { InstanceApi } from "../harness/instance";
import type { Scenario } from "../harness/scenario";
import { untilThreadIdle } from "../harness/threads";

// the scripted driver writes `# Agent note\n\n<text>\n` to Agent/<thread>.md on every turn.
const agentNote = (text: string): string => `# Agent note\n\n${text}\n`;
// above the heading, so an unchanged line stands between it and the line each turn rewrites.
const USER_LINE = "Call Sam about the draft";

const runTurn = async (api: InstanceApi, threadId: string, text: string): Promise<string> => {
  const outcome = await api.threads.send({ text, threadId });
  expect(outcome.kind === "started", `send outcome was "${outcome.kind}"`);
  await untilThreadIdle(api, threadId);
  return outcome.turnId;
};

const readOrNull = async (file: string): Promise<string | null> => {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
};

export const undoScripted: Scenario = {
  description: "undo takes one scripted turn back, keeping the line the user added since",
  name: "undo-scripted",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
    });
    const { api, vaultDir } = app;

    ctx.log("two turns write one note, then the user adds a line");
    const { thread } = await api.threads.create({ title: "e2e undo" });
    const notePath = `Agent/${thread.id}.md`;
    const noteFile = path.join(vaultDir, notePath);
    const first = await runTurn(api, thread.id, "first draft");
    const second = await runTurn(api, thread.id, "second draft");
    expectEq(await readOrNull(noteFile), agentNote("second draft"), "the second turn's bytes");
    await api.vault.write({
      content: `${USER_LINE}\n\n${agentNote("second draft")}`,
      guard: { kind: "overwrite" },
      path: notePath,
    });

    ctx.log("undo the second turn: the first turn's text, and the user's line");
    const undone = await api.threads.undoTurn({ threadId: thread.id, turnId: second });
    expectEq(undone.reverted.join(","), notePath, "the undo reverted the note");
    expectEq(undone.kept.length, 0, "notes the undo kept");
    const reverted = `${USER_LINE}\n\n${agentNote("first draft")}`;
    expectEq(await readOrNull(noteFile), reverted, "the note on disk after the undo");
    const { content } = await api.vault.read({ path: notePath });
    expectEq(content, reverted, "vault.read agrees");
    const { turns } = await api.threads.turnChanges({ threadId: thread.id });
    expectEq(
      turns.map((turn) => `${turn.turnId} ${turn.state}`).join("\n"),
      `${first} applied\n${second} undone`,
      "the turns' states",
    );

    ctx.log("undo the first turn: it made the note, and the note was edited since");
    const kept = await api.threads.undoTurn({ threadId: thread.id, turnId: first });
    expectEq(kept.reverted.length, 0, "notes the undo reverted");
    expectEq(
      kept.kept.map((row) => `${row.path} ${row.reason}`).join("\n"),
      `${notePath} edited-since`,
      "the note is kept, and why",
    );
    expectEq(await readOrNull(noteFile), reverted, "the kept note is untouched");

    ctx.log("a fresh action's untouched turn: its undo removes the note it made");
    const { thread: fresh } = await api.threads.create({ title: "e2e undo, untouched" });
    const freshFile = path.join(vaultDir, "Agent", `${fresh.id}.md`);
    const only = await runTurn(api, fresh.id, "a note to take back");
    expect((await readOrNull(freshFile)) !== null, "the turn made its note");
    const removed = await api.threads.undoTurn({ threadId: fresh.id, turnId: only });
    expectEq(removed.reverted.join(","), `Agent/${fresh.id}.md`, "the undo removed the note");
    expectEq(await readOrNull(freshFile), null, "the note is gone from disk");
  },
};
