import path from "node:path";
import { z } from "zod";
import { clickButtonIn, parseEval, untilBodyHolds } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { readOrNull } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import {
  ALERT_DIALOG,
  CONNECTOR_FORM,
  DIALOG_PRESENCE,
  NAME_INPUT,
  URL_INPUT,
} from "../harness/selectors";

// nothing listens on port 1, so claude's add looks for no sign-in and codex's finds none to start.
const DEAD_URL = "http://127.0.0.1:1/mcp";
const URL_NAME = "dead";
const COMMAND_NAME = "local";
const COMMAND = "npx";
const ARGUMENT = "some-server";
const DEADLINE_MS = 60_000;

const COMMAND_INPUT = `${CONNECTOR_FORM} input[placeholder="npx"]`;
const ARGS_INPUT = `${CONNECTOR_FORM} textarea`;

// the vendor's own file, which is what an agent session loads.
const untilFile = async (
  file: string,
  holds: (text: string) => boolean,
  what: string,
): Promise<void> => {
  await pollUntil(async () => (await readOrNull(file)) ?? "", holds, {
    deadlineMs: DEADLINE_MS,
    describe: (text) => `${file} never ${what}:\n${text}`,
    intervalMs: 250,
  });
};

// one row at a time is on screen, so its Remove is the only one; the confirm's own is scoped to it.
const removeThroughConfirm = async (agentBrowser: AgentBrowser): Promise<void> => {
  await agentBrowser(["find", "role", "button", "click", "--name", "Remove", "--exact"]);
  await agentBrowser(["wait", ALERT_DIALOG], 10_000);
  await clickButtonIn(agentBrowser, ALERT_DIALOG, "Remove");
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
    await untilBodyHolds(agentBrowser, ["Apps and services Claude can use"], DEADLINE_MS);
    await agentBrowser(["fill", NAME_INPUT, URL_NAME]);
    await agentBrowser(["fill", URL_INPUT, DEAD_URL]);
    await clickButtonIn(agentBrowser, CONNECTOR_FORM, "Add", 10_000);
    await untilFile(claudeFile, (text) => text.includes(DEAD_URL), `held ${DEAD_URL}`);
    await untilBodyHolds(agentBrowser, [DEAD_URL], DEADLINE_MS);

    ctx.log("under ChatGPT, the section lists codex's config, and a command lands in it");
    await app.api.agents.setDefault({ id: "codex" });
    await openSettings(agentBrowser, app);
    await untilBodyHolds(agentBrowser, ["Apps and services ChatGPT can use"], DEADLINE_MS);
    await agentBrowser(["fill", NAME_INPUT, COMMAND_NAME]);
    await agentBrowser(["find", "role", "radio", "click", "--name", "Command", "--exact"]);
    await agentBrowser(["wait", COMMAND_INPUT], 10_000);
    await agentBrowser(["fill", COMMAND_INPUT, COMMAND]);
    await agentBrowser(["fill", ARGS_INPUT, ARGUMENT]);
    await clickButtonIn(agentBrowser, CONNECTOR_FORM, "Add", 10_000);
    await untilFile(
      codexFile,
      (text) => text.includes(`[mcp_servers.${COMMAND_NAME}]`) && text.includes(ARGUMENT),
      `held [mcp_servers.${COMMAND_NAME}]`,
    );
    await untilBodyHolds(agentBrowser, [`${COMMAND} ${ARGUMENT}`], DEADLINE_MS);

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
    await untilBodyHolds(agentBrowser, [DEAD_URL], DEADLINE_MS);
    await removeThroughConfirm(agentBrowser);
    await untilFile(claudeFile, (text) => !text.includes(DEAD_URL), `let go of ${DEAD_URL}`);
    await untilBodyHolds(agentBrowser, ["No connectors yet."], DEADLINE_MS);
  },
};
