import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { modChord } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { COMPOSER, EDITOR } from "../harness/selectors";

const DOC_PATH = "Plans.md";
const DOC = `# Plans

First paragraph.
`;
const DICTATED = "Summarise this note";
const TYPED = " in three bullets";
const PHRASE = `${DICTATED}${TYPED}`;
const SAVE_DEADLINE_MS = 30_000;

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

// macOS dictation lands as one IME-style commit, which CDP's Input.insertText is; Chromium once
// left the caret before such a commit when it was the field's first edit after a programmatic
// focus, so the words typed next went in front of it.
const dictateThenType = async (agentBrowser: AgentBrowser): Promise<void> => {
  await agentBrowser(["keyboard", "inserttext", DICTATED]);
  await agentBrowser(["keyboard", "type", TYPED]);
};

export const osDictationBrowser: Scenario = {
  description:
    "words the OS dictates and words typed after them land in order, once, in the composer and in the note",
  name: "os-dictation-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
      // sorts before the seeded welcome note, so the virgin boot opens it.
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, DOC_PATH), DOC, "utf-8");
      },
    });
    const agentBrowser = await ctx.browser("os-dictation");

    ctx.log(`opening ${app.baseUrl}/`);
    await agentBrowser.openWorkspace(app);
    ctx.log("a caret on a new line of the note, for the composer to hand back");
    await agentBrowser(["click", EDITOR]);
    await agentBrowser(["press", "End"]);
    await agentBrowser(["press", "Enter"]);

    ctx.log("⌘K focuses the composer's field, then dictation and typing");
    await agentBrowser(["press", modChord("k")]);
    await agentBrowser(["wait", COMPOSER], 30_000);
    await dictateThenType(agentBrowser);
    expectEq(await agentBrowser(["get", "value", COMPOSER]), PHRASE, "the composer's text");
    const { threads } = await app.api.threads.list({});
    expectEq(threads.length, 0, "threads after dictating into the composer");

    ctx.log("Escape hands focus back to the note, then dictation and typing there");
    await agentBrowser(["press", "Escape"]);
    await agentBrowser(["wait", "--fn", `!document.querySelector('${COMPOSER}')`], 30_000);
    await dictateThenType(agentBrowser);

    const noteFile = path.join(app.vaultDir, DOC_PATH);
    const onDisk = await pollUntil(
      async () => await readFile(noteFile, "utf-8"),
      (text) => text.includes(DICTATED) && text.includes(TYPED),
      {
        deadlineMs: SAVE_DEADLINE_MS,
        describe: (text) => `the note never saved both halves:\n${text}`,
      },
    );
    expect(
      occurrences(onDisk, PHRASE) === 1 && occurrences(onDisk, DICTATED) === 1,
      `the note should hold "${PHRASE}" once, in order:\n${onDisk}`,
    );
  },
};
