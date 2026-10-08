import { modChord } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";
import { COMPOSER } from "../harness/selectors";

const DICTATED = "Summarise my week";
const TYPED = " in three bullets";
const PHRASE = `${DICTATED}${TYPED}`;

// macOS dictation lands as one IME-style commit, which CDP's Input.insertText is. As a field's first
// edit after a programmatic focus it must leave the caret after itself, or the words typed next land
// in front of it.
const dictateThenType = async (agentBrowser: AgentBrowser): Promise<void> => {
  await agentBrowser(["keyboard", "inserttext", DICTATED]);
  await agentBrowser(["keyboard", "type", TYPED]);
};

export const osDictationBrowser: Scenario = {
  description:
    "words the OS dictates and words typed after them land in order, once, in the composer",
  name: "os-dictation-browser",
  async run(ctx) {
    const app = await ctx.boot({ extraEnv: { INTELIGIR_AGENT: "scripted" }, name: "solo" });
    const agentBrowser = await ctx.browser("os-dictation");

    ctx.log(`opening ${app.baseUrl}/`);
    await agentBrowser.openWorkspace(app);

    ctx.log("⌘K focuses the composer's field, then dictation and typing");
    await agentBrowser(["press", modChord("k")]);
    await agentBrowser(["wait", COMPOSER], 30_000);
    await dictateThenType(agentBrowser);
    expectEq(await agentBrowser(["get", "value", COMPOSER]), PHRASE, "the composer's text");
    const { threads } = await app.api.threads.list({});
    expectEq(threads.length, 0, "threads after dictating into the composer");
  },
};
