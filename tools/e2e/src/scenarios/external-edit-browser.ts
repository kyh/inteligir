import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const PROMPT = "rewrite the note";
const BASE_NOTE = "# Agent note\n\nthe line that was already here\n";
const TURN_DEADLINE_MS = 30_000;

export const externalEditBrowser: Scenario = {
  description:
    "a clean buffer adopts an agent write; a dirty buffer merges instead of clobbering, and adopts the merge",
  name: "external-edit-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
    });

    ctx.log("create the thread whose scripted turn owns a note path");
    const { thread } = await app.api.threads.create({ title: PROMPT });
    // the scripted driver writes exactly here.
    const notePath = `Agent/${thread.id}.md`;
    const noteFile = path.join(app.vaultDir, notePath);
    await app.api.vault.write({ content: BASE_NOTE, guard: { kind: "absent" }, path: notePath });

    const agentBrowser = await ctx.browser("external-edit");
    const readBuffer = async (): Promise<string> => await agentBrowser(["get", "text", EDITOR]);
    const readDisk = async (): Promise<string> => await readFile(noteFile, "utf-8");

    ctx.log(`opening ${app.baseUrl}/`);
    // deep link rather than listing order: the seeded Welcome note outranks "first doc".
    await agentBrowser.openWorkspace(app, { path: `/?note=${encodeURIComponent(notePath)}` });
    const opened = await readBuffer();
    expect(
      opened.includes("the line that was already here"),
      `the browser did not open ${notePath} — got: ${opened}`,
    );

    ctx.log("clean buffer: the agent rewrites the note, the editor adopts");
    await app.api.threads.send({ text: PROMPT, threadId: thread.id });

    const adopted = await pollUntil(readBuffer, (buffer) => buffer.includes(PROMPT), {
      deadlineMs: TURN_DEADLINE_MS,
      describe: (buffer) => `the buffer never adopted the write — got: ${buffer}`,
    });
    expect(
      !adopted.includes("the line that was already here"),
      `the buffer kept the replaced base:\n${adopted}`,
    );
    const rewritten = await readDisk();
    expect(rewritten.includes(PROMPT), `the agent's write never reached disk:\n${rewritten}`);

    ctx.log("dirty buffer: a mid-keystroke external write merges on the save");
    await agentBrowser(["click", EDITOR]);
    await agentBrowser(["press", "End"]);
    await agentBrowser(["type", EDITOR, " user-typed-tail"]);
    // inside the autosave debounce: append a line the buffer does not hold.
    const external = `${rewritten}\nexternal-appended-line\n`;
    await writeFile(noteFile, external, "utf-8");

    await pollUntil(
      readDisk,
      (onDisk) => onDisk.includes("user-typed-tail") && onDisk.includes("external-appended-line"),
      {
        deadlineMs: TURN_DEADLINE_MS,
        describe: (onDisk) => `disk never held both sides of the merge:\n${onDisk}`,
      },
    );

    ctx.log("the buffer adopts the merge, so the next save keeps the external line");
    await pollUntil(readBuffer, (buffer) => buffer.includes("external-appended-line"), {
      deadlineMs: TURN_DEADLINE_MS,
      describe: (buffer) => `the buffer never adopted the merged bytes — got: ${buffer}`,
    });
    await agentBrowser(["click", EDITOR]);
    await agentBrowser(["press", "End"]);
    await agentBrowser(["type", EDITOR, " second-typed-tail"]);

    const secondSave = await pollUntil(readDisk, (onDisk) => onDisk.includes("second-typed-tail"), {
      deadlineMs: TURN_DEADLINE_MS,
      describe: (onDisk) => `the second save never reached disk:\n${onDisk}`,
    });
    expect(
      secondSave.includes("external-appended-line"),
      `the save after the merge erased the external line:\n${secondSave}`,
    );
  },
};
