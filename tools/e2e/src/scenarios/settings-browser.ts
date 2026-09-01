// /settings is its own route, and the window-level hosts must answer there:
// Unpair awaits `confirm()`, so the dialog has to OPEN on this route, and a
// refused verb has to TOAST here rather than wait for the next visit to "/".
// Both are driven through the real page against a real instance.
//
// The instance boots PAIRED against a cloud nothing answers on. The credential
// file alone is what puts the Unpair button on screen — the sync loop's
// refusals are beside the point, and a refused connection fails fast.

import { setTimeout as delay } from "node:timers/promises";
import { writeDeviceCredential } from "inteligir/server/cloud/credential-store";
import { z } from "zod";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("settings");
/** Nothing listens on port 1, so every request the pairing makes is refused
 *  at once rather than hanging on a timeout. */
const DEAD_CLOUD_URL = "http://127.0.0.1:1";
const CONNECTOR_NAME = "dupe";
const CONNECTOR_URL = "https://mcp.example.com/mcp";
const STATUS_DEADLINE_MS = 30_000;
const ALERT_DIALOG = '[role="alertdialog"]';
const TOAST = "[data-sonner-toast]";
/** The add-connector form's fields, by the placeholders the page shows —
 *  their ids are React-minted per mount. */
const NAME_INPUT = 'input[placeholder="context7"]';
const URL_INPUT = `input[placeholder="${CONNECTOR_URL}"]`;
/** The form's own Add button by its exact label: `find text` would also
 *  match the "Add a connector" heading beside it. */
const CLICK_ADD = `(() => {
  const button = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Add");
  if (!button) return "missing";
  if (button.disabled) return "disabled";
  button.click();
  return "clicked";
})()`;

function parseEval<T>(raw: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(raw));
}

export const settingsBrowser: Scenario = {
  name: "settings-browser",
  description: "/settings hosts the dialog and the toaster: Unpair confirms, a refused add toasts",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_CLOUD_URL: DEAD_CLOUD_URL, INTELIGIR_SYNC_INTERVAL_MS: "0" },
      seedData: (dataDir) => {
        writeDeviceCredential(dataDir, {
          deviceId: "dev_settings_e2e",
          credential: `igd_${"0".repeat(64)}`,
        });
        return Promise.resolve();
      },
    });
    // The row the form's add will collide with — the one refusal this page
    // reports through a toast rather than beside the field.
    await app.api.connectors.add({
      name: CONNECTOR_NAME,
      transport: { kind: "http", url: CONNECTOR_URL },
    });

    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/settings`);
      await agentBrowser(["open", `${app.baseUrl}/settings`], 60_000);
      await agentBrowser(["wait", NAME_INPUT], 90_000);

      ctx.log("waiting for the paired status to reach the page");
      const statusDeadline = Date.now() + STATUS_DEADLINE_MS;
      for (;;) {
        const body = await agentBrowser(["get", "text", "body"]);
        if (body.includes("Unpair")) {
          break;
        }
        expect(Date.now() < statusDeadline, `the Devices section never showed Unpair:\n${body}`);
        await delay(500);
      }

      ctx.log("Unpair awaits a confirm: the dialog opens on this route");
      await agentBrowser(["find", "text", "Unpair", "click"]);
      await agentBrowser(["wait", ALERT_DIALOG], 30_000);
      const dialog = await agentBrowser(["get", "text", ALERT_DIALOG]);
      expect(
        dialog.includes("Stop syncing this device?"),
        `the confirm dialog did not carry the Unpair prompt:\n${dialog}`,
      );
      await agentBrowser(["press", "Escape"]);

      ctx.log("a refused add toasts on this route");
      await agentBrowser(["fill", NAME_INPUT, CONNECTOR_NAME]);
      await agentBrowser(["fill", URL_INPUT, CONNECTOR_URL]);
      const clicked = parseEval(await agentBrowser(["eval", CLICK_ADD]), z.string());
      expect(clicked === "clicked", `the Add button was ${clicked}`);
      await agentBrowser(["wait", TOAST], 30_000);
      const toastText = await agentBrowser(["get", "text", TOAST]);
      expect(
        toastText.includes("already exists"),
        `the toast did not carry the refusal:\n${toastText}`,
      );
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
