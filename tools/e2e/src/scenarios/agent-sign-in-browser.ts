import path from "node:path";
import { z } from "zod";
import { modChord, parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expectEq } from "../harness/assert";
import type { InstanceApi } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { COMPOSER, EDITOR, PALETTE_INPUT } from "../harness/selectors";

// what the fake claude's sign-in page would show, and the only code its login takes.
const PAGE_CODE = "e2e-code#e2e-state";
// the ⌘K popup. The Actions panel, collapsed beside it and still in the page, draws the same
// sign-in under the same names, so every read and press of the composer's is scoped to it: a
// press on the panel's copy lands outside the popup and dismisses it.
const COMPOSER_POPUP = '[role="dialog"][aria-label="Action composer"]';
const COMPOSER_TEXT = `document.querySelector('${COMPOSER_POPUP}')?.textContent ?? ""`;
const CODE_INPUT = `${COMPOSER_POPUP} input[placeholder="Code from the sign-in page"]`;
const REPLY = 'textarea[aria-label="Reply to the agent"]';
const ACTION_TITLE = "Ask ChatGPT to draft";
const DEADLINE_MS = 60_000;

// the card titles, found by their exact text: the section's lead names both agents too.
const CARD_ORDER = `(() => {
  const exact = (text) => [...document.querySelectorAll("p")].find((el) => el.textContent.trim() === text);
  const [claude, other, chatGpt] = ["Claude", "Other", "ChatGPT"].map(exact);
  if (!claude || !other || !chatGpt) return "missing";
  const follows = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return follows(claude, other) && follows(other, chatGpt) ? "ordered" : "out of order";
})()`;

const untilBodyHolds = async (
  agentBrowser: AgentBrowser,
  needles: readonly string[],
): Promise<void> => {
  await pollUntil(
    async () => await agentBrowser(["get", "text", "body"]),
    (body) => needles.every((needle) => body.includes(needle)),
    {
      deadlineMs: DEADLINE_MS,
      describe: (body) => `the page never said ${needles.join(" and ")}:\n${body}`,
      intervalMs: 500,
    },
  );
};

const untilComposerHolds = async (
  agentBrowser: AgentBrowser,
  needles: readonly string[],
): Promise<void> => {
  await pollUntil(
    async () => parseEval(await agentBrowser(["eval", COMPOSER_TEXT]), z.string()),
    (text) => needles.every((needle) => text.includes(needle)),
    {
      deadlineMs: DEADLINE_MS,
      describe: (text) =>
        `the composer never said ${needles.join(" and ")}: ${text === "" ? "it is not open" : text}`,
      intervalMs: 500,
    },
  );
};

const pressInComposer = (name: string): string => `(() => {
  const popup = document.querySelector('${COMPOSER_POPUP}');
  const button = popup ? [...popup.querySelectorAll("button")].find((el) => el.textContent.trim() === ${JSON.stringify(name)}) : null;
  if (!button) return "missing";
  if (button.disabled) return "disabled";
  button.click();
  return "clicked";
})()`;

// retried until it lands: a button drawn a render before its field's state enables it is refused.
const clickInComposer = async (agentBrowser: AgentBrowser, name: string): Promise<void> => {
  await pollUntil(
    async () => parseEval(await agentBrowser(["eval", pressInComposer(name)]), z.string()),
    (outcome) => outcome === "clicked",
    {
      deadlineMs: 10_000,
      describe: (outcome) => `the composer's ${name} button stayed ${outcome}`,
    },
  );
};

const accountState = async (api: InstanceApi, id: string): Promise<string | null> => {
  const status = await api.agents.status();
  const harness = status.harnesses.find((candidate) => candidate.id === id);
  return harness?.runtime === "bundled" ? harness.account.state : null;
};

export const agentSignInBrowser: Scenario = {
  description:
    "signed out, ⌘K offers Sign in with Claude, whose login takes the pasted code and opens the field; Settings shows Claude signed in and ChatGPT under Other; a send on the real bundled codex, signed out, puts its sign-in above the reply",
  name: "agent-sign-in-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: {
        CLAUDE_CODE_EXECUTABLE: path.join(
          ctx.repoRoot,
          "tools",
          "e2e",
          "src",
          "fixtures",
          "fake-claude.mjs",
        ),
        FAKE_CLAUDE_CODE: PAGE_CODE,
        FAKE_CLAUDE_MARKER: path.join(ctx.scratchDir, "claude-signed-in"),
        INTELIGIR_AGENT: "auto",
      },
      name: "solo",
    });
    expectEq(await accountState(app.api, "claude"), "signed-out", "claude before the sign-in");
    const agentBrowser = await ctx.browser("agent-sign-in");
    await agentBrowser.openWorkspace(app);

    ctx.log("⌘K over a signed-out Claude offers its sign-in in place of the field");
    await agentBrowser(["press", modChord("k")]);
    await untilComposerHolds(agentBrowser, ["Sign in to ask the agent.", "Sign in with Claude"]);
    await clickInComposer(agentBrowser, "Sign in with Claude");

    ctx.log("the login prints its page, and takes the code pasted from it");
    await untilComposerHolds(agentBrowser, [
      "Finish signing in in your browser.",
      "Paste the code",
    ]);
    await clickInComposer(agentBrowser, "Paste the code");
    await agentBrowser(["wait", CODE_INPUT], 30_000);
    await agentBrowser(["fill", CODE_INPUT, PAGE_CODE]);
    await clickInComposer(agentBrowser, "Continue");
    await agentBrowser(["wait", `${COMPOSER_POPUP} ${COMPOSER}`], DEADLINE_MS);
    expectEq(await accountState(app.api, "claude"), "signed-in", "claude after the sign-in");

    ctx.log("Settings shows Claude signed in, and ChatGPT signed out under Other");
    await agentBrowser(["open", await app.browserUrl("/settings")], 60_000);
    await untilBodyHolds(agentBrowser, [
      "Signed in · Claude Max · ada@example.com",
      "Sign in with ChatGPT",
    ]);
    expectEq(
      parseEval(await agentBrowser(["eval", CARD_ORDER]), z.string()),
      "ordered",
      "Claude's card, then Other, then ChatGPT's",
    );

    ctx.log("a send on ChatGPT reaches the bundled codex, which is signed out here");
    await app.api.agents.setDefault({ id: "codex" });
    const { thread } = await app.api.threads.create({ title: ACTION_TITLE });
    await app.api.threads.send({ text: "draft the plan", threadId: thread.id });
    await pollUntil(
      async () => {
        const read = await app.api.threads.get({ threadId: thread.id });
        return read.thread;
      },
      (current) => current.status === "idle" || current.status === "error",
      {
        deadlineMs: DEADLINE_MS,
        describe: (current) => `the refused turn is still "${current.status}"`,
      },
    );
    expectEq(await accountState(app.api, "codex"), "signed-out", "codex under an empty store");

    ctx.log("the action's panel puts ChatGPT's sign-in above the reply");
    await agentBrowser.openWorkspace(app);
    await agentBrowser(["click", EDITOR]);
    await agentBrowser(["press", modChord("p")]);
    await agentBrowser(["wait", PALETTE_INPUT], 30_000);
    await agentBrowser(["find", "role", "option", "click", "--name", "Actions", "--exact"]);
    await agentBrowser(["find", "role", "option", "click", "--name", ACTION_TITLE]);
    await untilBodyHolds(agentBrowser, [
      "ChatGPT is signed out on this Mac.",
      "Sign in with ChatGPT",
    ]);
    await agentBrowser(["wait", REPLY], 30_000);
  },
};
