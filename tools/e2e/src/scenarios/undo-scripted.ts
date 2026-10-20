import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, expectEq } from "../harness/assert";
import { gitIn, readOrNull } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import { solidPng } from "../harness/png-pixels";
import type { Scenario } from "../harness/scenario";
import { agentNote, runTurn } from "../harness/threads";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const hashOnDisk = async (vaultDir: string, vaultPath: string): Promise<string | null> => {
  const absolute = path.join(vaultDir, vaultPath);
  return existsSync(absolute) ? sha256(new Uint8Array(await readFile(absolute))) : null;
};

const RED = solidPng(16, 16, [220, 20, 30, 255]);
const GREEN = solidPng(16, 16, [20, 200, 40, 255]);
const BLUE = solidPng(16, 16, [20, 40, 220, 255]);

// a turn's changes can span several commits (a commit stages at most its budget), each carrying
// the turn's own message: the scripted driver writes only its note, so the pictures land in one
// more commit under the message its commit carries, as a turn's next commit would
const commitAsTheTurn = async (
  app: AppInstance,
  turnId: string,
  paths: readonly string[],
): Promise<void> => {
  const message = await pollUntil(
    async () =>
      await gitIn(app.vaultDir, [
        "log",
        "-1",
        "--format=%B",
        "--fixed-strings",
        `--grep=${turnId}`,
      ]),
    (body) => body !== "",
    { deadlineMs: 30_000, describe: () => `turn ${turnId} never committed` },
  );
  await gitIn(app.vaultDir, ["add", "-A", "--", ...paths]);
  await gitIn(app.vaultDir, ["commit", "-q", "-m", message]);
};

const undoesPicturesByteExact = async (app: AppInstance): Promise<void> => {
  const { api, vaultDir } = app;
  await mkdir(path.join(vaultDir, "assets"), { recursive: true });
  await writeFile(path.join(vaultDir, "assets", "shot.png"), RED);
  await writeFile(path.join(vaultDir, "assets", "gone.png"), GREEN);
  await api.vault.commitNow();

  const { thread } = await api.threads.create({ title: "e2e undo, pictures" });
  const turnId = await runTurn(api, thread.id, "pictures");
  await writeFile(path.join(vaultDir, "assets", "shot.png"), BLUE);
  await rm(path.join(vaultDir, "assets", "gone.png"));
  await commitAsTheTurn(app, turnId, ["assets/shot.png", "assets/gone.png"]);

  const undone = await api.threads.undoTurn({ threadId: thread.id, turnId });
  expectEq(
    undone.reverted.toSorted().join(","),
    [`Agent/${thread.id}.md`, "assets/gone.png", "assets/shot.png"].toSorted().join(","),
    "the undo reverted the note and both pictures",
  );
  expectEq(undone.kept.length, 0, "paths the undo kept");
  expectEq(await hashOnDisk(vaultDir, "assets/shot.png"), sha256(RED), "the overwritten picture");
  expectEq(await hashOnDisk(vaultDir, "assets/gone.png"), sha256(GREEN), "the deleted picture");
};

// above the heading, so an unchanged line stands between it and the line each turn rewrites.
const USER_LINE = "Call Sam about the draft";

export const undoScripted: Scenario = {
  description:
    "undoing the second of two scripted turns leaves the first turn's text and a line the user added since, on disk and through `vault.read`; the first turn's note is then kept as edited since, an untouched turn's undo removes the note it made, and a turn's overwrite and delete of a PNG each undo byte-exact",
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

    ctx.log("a turn overwrites one picture and deletes another: its undo puts both back exactly");
    await undoesPicturesByteExact(app);
  },
};
