import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { modChord, parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import type { InstanceApi } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import {
  clickToastAction,
  COMPOSER,
  EDITOR,
  PALETTE_INPUT,
  TOAST_TEXT,
} from "../harness/selectors";
import { untilThreadIdle } from "../harness/threads";

// the scripted driver writes `# Agent note\n\n<text>\n` to Agent/<thread>.md on every turn.
const agentNote = (text: string): string => `# Agent note\n\n${text}\n`;
const MESSAGE = "draft the plan";
const SECOND_TITLE = "Two drafts to take back";
// typed at the top, so the heading and a blank line stand between it and the line each turn
// rewrites, which is what lets the undo keep it.
const USER_LINE = "Call Sam about the draft";
const DEADLINE_MS = 30_000;
const NO_DIALOG = `document.querySelector('[data-slot="dialog-content"]') === null`;

const UNDO_BUTTONS = `[...document.querySelectorAll("button")].filter((el) => el.textContent.trim() === "Undo changes")`;
const UNDO_BUTTON_COUNT = `String(${UNDO_BUTTONS}.length)`;
// the last reply's footer: turn 2 sits below turn 1.
const CLICK_LAST_UNDO = `(() => {
  const button = ${UNDO_BUTTONS}.at(-1);
  if (!button) return "missing";
  button.click();
  return "clicked";
})()`;

const readOrNull = async (file: string): Promise<string | null> => {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
};

const runTurn = async (api: InstanceApi, threadId: string, text: string): Promise<void> => {
  const outcome = await api.threads.send({ text, threadId });
  expect(outcome.kind === "started", `send outcome was "${outcome.kind}"`);
  await untilThreadIdle(api, threadId);
};

const untilBodyHolds = async (agentBrowser: AgentBrowser, needle: string): Promise<void> => {
  await pollUntil(
    async () => await agentBrowser(["get", "text", "body"]),
    (body) => body.includes(needle),
    {
      deadlineMs: DEADLINE_MS,
      describe: (body) => `the page never said "${needle}":\n${body}`,
      intervalMs: 500,
    },
  );
};

export const undoBrowser: Scenario = {
  description:
    "a finished action toasts what it edited and Undo takes it back; a reply's Undo changes keeps a line typed since",
  name: "undo-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
    });
    const agentBrowser = await ctx.browser("undo");

    ctx.log(`opening ${app.baseUrl}/`);
    await agentBrowser.openWorkspace(app);

    ctx.log("⌘K sends; the finished turn toasts the notes it edited");
    await agentBrowser(["press", modChord("k")]);
    await agentBrowser(["wait", COMPOSER], 30_000);
    await agentBrowser(["fill", COMPOSER, MESSAGE]);
    await agentBrowser(["press", modChord("Enter")]);
    await pollUntil(
      async () => parseEval(await agentBrowser(["eval", TOAST_TEXT]), z.string()),
      (text) => text.includes("Agent edited 1 note"),
      {
        deadlineMs: DEADLINE_MS,
        describe: (text) => `no finish toast — the toasts said:\n${text}`,
      },
    );
    const { threads } = await app.api.threads.list({});
    const [launched] = threads;
    expect(launched !== undefined, "the composer made no action");
    const firstFile = path.join(app.vaultDir, "Agent", `${launched.id}.md`);
    expectEq(await readOrNull(firstFile), agentNote(MESSAGE), "the note the turn made");

    ctx.log("the toast's Undo takes the note back, and the reply says its changes were undone");
    const clicked = parseEval(
      await agentBrowser(["eval", clickToastAction("Agent edited 1 note")]),
      z.string(),
    );
    expectEq(clicked, "clicked", "the toast's Undo");
    await pollUntil(
      async () => await readOrNull(firstFile),
      (text) => text === null,
      {
        deadlineMs: DEADLINE_MS,
        describe: (text) => `the undone note is still on disk:\n${text ?? ""}`,
      },
    );
    await untilBodyHolds(agentBrowser, "Changes undone");

    ctx.log("a second action's two turns rewrite its note");
    const { thread: second } = await app.api.threads.create({ title: SECOND_TITLE });
    const secondPath = `Agent/${second.id}.md`;
    const secondFile = path.join(app.vaultDir, secondPath);
    await runTurn(app.api, second.id, "first draft");
    await runTurn(app.api, second.id, "second draft");
    expectEq(await readOrNull(secondFile), agentNote("second draft"), "the second turn's bytes");

    ctx.log("open the note, and that action's transcript from ⌘P");
    await agentBrowser.openWorkspace(app, { path: `/?note=${encodeURIComponent(secondPath)}` });
    await agentBrowser(["click", EDITOR]);
    await agentBrowser(["press", modChord("p")]);
    await agentBrowser(["wait", PALETTE_INPUT], 30_000);
    await agentBrowser(["find", "role", "option", "click", "--name", "Actions", "--exact"]);
    await agentBrowser(["find", "role", "option", "click", "--name", SECOND_TITLE]);
    // a palette that closed on a pick covers the note until its exit tween ends
    await agentBrowser(["wait", "--fn", NO_DIALOG], 30_000);
    await pollUntil(
      async () => parseEval(await agentBrowser(["eval", UNDO_BUTTON_COUNT]), z.string()),
      (count) => count === "2",
      {
        deadlineMs: DEADLINE_MS,
        describe: (count) => `expected an Undo changes on each of 2 replies, saw ${count}`,
      },
    );

    ctx.log("type a line at the top, and undo the second turn before the autosave lands");
    await agentBrowser(["click", `${EDITOR} h1`]);
    await agentBrowser(["press", "Home"]);
    await agentBrowser(["keyboard", "type", USER_LINE]);
    await agentBrowser(["press", "Enter"]);
    expectEq(
      parseEval(await agentBrowser(["eval", CLICK_LAST_UNDO]), z.string()),
      "clicked",
      "the second reply's Undo changes",
    );

    const kept = (text: string | null): boolean =>
      text !== null &&
      text.includes(USER_LINE) &&
      text.includes("first draft") &&
      !text.includes("second draft");
    await pollUntil(async () => await readOrNull(secondFile), kept, {
      deadlineMs: DEADLINE_MS,
      describe: (text) =>
        `disk never held the first draft beside the typed line:\n${text ?? "(no file)"}`,
    });
    await pollUntil(async () => await agentBrowser(["get", "text", EDITOR]), kept, {
      deadlineMs: DEADLINE_MS,
      describe: (text) => `the editor never showed the first draft and the typed line:\n${text}`,
    });
    await pollUntil(
      async () => parseEval(await agentBrowser(["eval", UNDO_BUTTON_COUNT]), z.string()),
      (count) => count === "1",
      {
        deadlineMs: DEADLINE_MS,
        describe: (count) => `the undone reply still offers Undo changes (${count} left)`,
      },
    );
    await untilBodyHolds(agentBrowser, "Changes undone");
  },
};
