import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

// nothing listens on port 1, so claude's add looks for no sign-in and codex's finds none to start.
const DEAD_URL = "http://127.0.0.1:1/mcp";
const URL_NAME = "dead";
const COMMAND_NAME = "local";
const COMMAND = "npx";
const ARGUMENT = "some-server";
const DEADLINE_MS = 60_000;

// the hand-written connector's form: the presets above it carry Add buttons of their own. by
// placeholder inside it, since the ids are React-minted per mount.
const FORM = 'form[aria-label="Another connector"]';
const NAME_INPUT = `${FORM} input[placeholder="my-connector"]`;
const URL_INPUT = `${FORM} input[placeholder="https://example.com"]`;
const COMMAND_INPUT = `${FORM} input[placeholder="npx"]`;
const ARGS_INPUT = `${FORM} textarea`;
const SUBMIT = `(() => {
  const button = document.querySelector('${FORM} button[type="submit"]');
  if (!button) return "missing";
  if (button.disabled) return "disabled";
  button.click();
  return "clicked";
})()`;
// the open one: an answered confirm stays in the DOM through its exit animation.
const ALERT_DIALOG = '[role="alertdialog"][data-open]';
const CONFIRM_REMOVE = `(() => {
  const dialog = document.querySelector('${ALERT_DIALOG}');
  const button = dialog ? [...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Remove") : null;
  if (!button) return "missing";
  button.click();
  return "clicked";
})()`;
const DIALOG_PRESENCE = `document.querySelector('[role="alertdialog"]') === null ? "gone" : "present"`;

const untilBodyHolds = async (agentBrowser: AgentBrowser, needle: string): Promise<void> => {
  await pollUntil(
    async () => await agentBrowser(["get", "text", "body"]),
    (body) => body.includes(needle),
    {
      deadlineMs: DEADLINE_MS,
      describe: (body) => `the page never said ${needle}:\n${body}`,
      intervalMs: 500,
    },
  );
};

const readOrEmpty = async (file: string): Promise<string> => {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return "";
  }
};

// the vendor's own file, which is what an agent session loads.
const untilFile = async (
  file: string,
  holds: (text: string) => boolean,
  what: string,
): Promise<void> => {
  await pollUntil(async () => await readOrEmpty(file), holds, {
    deadlineMs: DEADLINE_MS,
    describe: (text) => `${file} never ${what}:\n${text}`,
    intervalMs: 250,
  });
};

// retried until it lands: a button drawn a render before its field's state enables it is refused.
const submitForm = async (agentBrowser: AgentBrowser): Promise<void> => {
  await pollUntil(
    async () => parseEval(await agentBrowser(["eval", SUBMIT]), z.string()),
    (outcome) => outcome === "clicked",
    { deadlineMs: 10_000, describe: (outcome) => `the form's Add button stayed ${outcome}` },
  );
};

// one row at a time is on screen, so its Remove is the only one; the confirm's own is scoped to it.
const removeThroughConfirm = async (agentBrowser: AgentBrowser): Promise<void> => {
  await agentBrowser(["find", "role", "button", "click", "--name", "Remove", "--exact"]);
  await agentBrowser(["wait", ALERT_DIALOG], 10_000);
  const confirmed = parseEval(await agentBrowser(["eval", CONFIRM_REMOVE]), z.string());
  expect(confirmed === "clicked", `the confirm's Remove was ${confirmed}`);
  await pollUntil(
    async () => parseEval(await agentBrowser(["eval", DIALOG_PRESENCE]), z.string()),
    (presence) => presence === "gone",
    { deadlineMs: DEADLINE_MS, describe: () => "the confirm never left the page", intervalMs: 100 },
  );
};

const openSettings = async (agentBrowser: AgentBrowser, app: AppInstance): Promise<void> => {
  await agentBrowser(["open", await app.browserUrl("/settings")], 60_000);
  await agentBrowser(["wait", NAME_INPUT], 90_000);
};

export const connectorsBrowser: Scenario = {
  description:
    "Settings' connectors are the default agent's own config, through the real bundled binaries: a URL added under Claude lands in its .claude.json, a command added under ChatGPT in codex's config.toml, and each Remove confirms and takes its row out of that file",
  name: "connectors-browser",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    const claudeFile = path.join(app.vendorDirs.claudeConfigDir, ".claude.json");
    const codexFile = path.join(app.vendorDirs.codexHome, "config.toml");
    const agentBrowser = await ctx.browser("connectors");

    ctx.log("under Claude, a URL added by hand lands in claude's own config");
    await openSettings(agentBrowser, app);
    await untilBodyHolds(agentBrowser, "Apps and services Claude can use");
    await agentBrowser(["fill", NAME_INPUT, URL_NAME]);
    await agentBrowser(["fill", URL_INPUT, DEAD_URL]);
    await submitForm(agentBrowser);
    await untilFile(claudeFile, (text) => text.includes(DEAD_URL), `held ${DEAD_URL}`);
    await untilBodyHolds(agentBrowser, DEAD_URL);

    ctx.log("under ChatGPT, the section lists codex's config, and a command lands in it");
    await app.api.agents.setDefault({ id: "codex" });
    await openSettings(agentBrowser, app);
    await untilBodyHolds(agentBrowser, "Apps and services ChatGPT can use");
    await agentBrowser(["fill", NAME_INPUT, COMMAND_NAME]);
    await agentBrowser(["find", "role", "radio", "click", "--name", "Command", "--exact"]);
    await agentBrowser(["wait", COMMAND_INPUT], 10_000);
    await agentBrowser(["fill", COMMAND_INPUT, COMMAND]);
    await agentBrowser(["fill", ARGS_INPUT, ARGUMENT]);
    await submitForm(agentBrowser);
    await untilFile(
      codexFile,
      (text) => text.includes(`[mcp_servers.${COMMAND_NAME}]`) && text.includes(ARGUMENT),
      `held [mcp_servers.${COMMAND_NAME}]`,
    );
    await untilBodyHolds(agentBrowser, `${COMMAND} ${ARGUMENT}`);

    ctx.log("Remove confirms, then takes the command out of codex's config");
    await removeThroughConfirm(agentBrowser);
    await untilFile(
      codexFile,
      (text) => !text.includes(`[mcp_servers.${COMMAND_NAME}]`),
      `let go of [mcp_servers.${COMMAND_NAME}]`,
    );

    ctx.log("back under Claude, Remove takes the URL out of claude's config");
    await app.api.agents.setDefault({ id: "claude" });
    await openSettings(agentBrowser, app);
    await untilBodyHolds(agentBrowser, DEAD_URL);
    await removeThroughConfirm(agentBrowser);
    await untilFile(claudeFile, (text) => !text.includes(DEAD_URL), `let go of ${DEAD_URL}`);
    await untilBodyHolds(agentBrowser, "No connectors yet.");
  },
};
