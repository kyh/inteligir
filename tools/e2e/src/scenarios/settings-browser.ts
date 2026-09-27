import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DEVICE_CREDENTIAL_PREFIX } from "@repo/api/cloud/device/device-schema";
import { writeDeviceCredential } from "inteligir/server/cloud/credential-store";
import { z } from "zod";
import { clickButtonIn, parseEval, untilBodyHolds } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import {
  ALERT_DIALOG,
  CONNECTOR_FORM,
  DIALOG_PRESENCE,
  NAME_INPUT,
  TOAST,
  URL_INPUT,
} from "../harness/selectors";
import { NO_AUTO_SYNC } from "../harness/vault-sync";

// nothing listens on port 1, so every cloud request is refused at once; the credential file alone
// puts Sign out on screen.
const DEAD_CLOUD_URL = "http://127.0.0.1:1";
const CONNECTOR_NAME = "dupe";
const CONNECTOR_URL = "https://mcp.example.com/mcp";
const STATUS_DEADLINE_MS = 30_000;
// the section's own heading, not a row or the nav link that share its word
const ACCOUNT_HEADING = `[...document.querySelectorAll("h3")].some((el) => el.textContent.trim() === "Account") ? "drawn" : "missing"`;
const DEVICES_UNREACHABLE = "Couldn't reach your account to list its devices.";
// by its title, so no other dialog on the page can stand in for it
const DELETE_DIALOG = `[...document.querySelectorAll('[role="dialog"]')].find((el) => el.textContent.includes("Delete your account?"))`;
const DELETE_DIALOG_PRESENCE = `(${DELETE_DIALOG}) ? "present" : "gone"`;
const DELETE_PASSWORD = '[role="dialog"] input[type="password"]';
// the dialog's own button: the section's Delete account… behind it carries an ellipsis
const DELETE_BUTTON_STATE = `(() => {
  const dialog = ${DELETE_DIALOG};
  const button = dialog ? [...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Delete account") : null;
  if (!button) return "missing";
  return button.disabled ? "disabled" : "enabled";
})()`;
const CLICK_DELETE = `(() => {
  const dialog = ${DELETE_DIALOG};
  const button = dialog ? [...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Delete account") : null;
  if (!button) return "missing";
  if (button.disabled) return "disabled";
  button.click();
  return "clicked";
})()`;
const DELETE_DIALOG_TEXT = `(() => { const dialog = ${DELETE_DIALOG}; return dialog ? dialog.textContent : ""; })()`;
const NEW_ACCOUNT = {
  email: "new@inteligir.local",
  inviteCode: "E2E-NO-CLOUD",
  name: "New Person",
  password: "a fresh passphrase",
};
// each field of the form that holds "Invite code", by its label: the connector form beside it has a
// Name too, and the ids are React-minted per mount.
const ACCOUNT_FIELDS = `(() => {
  const labelled = (root, text) => [...root.querySelectorAll("label")].find((el) => el.textContent.trim() === text);
  const invite = labelled(document, "Invite code");
  const form = invite ? invite.closest("form") : null;
  if (!form) return "missing";
  const field = (text) => {
    const label = labelled(form, text);
    const input = label ? document.getElementById(label.htmlFor) : null;
    return input ? { selector: "#" + CSS.escape(input.id), value: input.value } : null;
  };
  return JSON.stringify({ email: field("Email"), inviteCode: field("Invite code"), name: field("Name"), password: field("Password") });
})()`;
const fieldSchema = z.object({ selector: z.string(), value: z.string() });
const accountFieldsSchema = z.object({
  email: fieldSchema,
  inviteCode: fieldSchema,
  name: fieldSchema,
  password: fieldSchema,
});

export const settingsBrowser: Scenario = {
  description:
    "/settings hosts the dialog and the toaster: the Account section says a dead cloud's device list couldn't load, Delete account… holds its button until a password is typed and shows the dead cloud's refusal, Sign out confirms, a refused connector add toasts, and signed out a refused sign-up keeps the form",
  name: "settings-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_CLOUD_URL: DEAD_CLOUD_URL, ...NO_AUTO_SYNC },
      name: "solo",
      seedData: (dataDir) => {
        writeDeviceCredential(dataDir, {
          credential: `${DEVICE_CREDENTIAL_PREFIX}${"0".repeat(64)}`,
          deviceId: "dev_settings_e2e",
        });
      },
    });
    // the row the form's add will collide with, in the claude store the instance runs claude over.
    await writeFile(
      path.join(app.vendorDirs.claudeConfigDir, ".claude.json"),
      JSON.stringify({ mcpServers: { [CONNECTOR_NAME]: { type: "http", url: CONNECTOR_URL } } }),
    );

    const agentBrowser = await ctx.browser("settings");

    ctx.log(`opening ${app.baseUrl}/settings`);
    await agentBrowser(["open", await app.browserUrl("/settings")], 60_000);
    await agentBrowser(["wait", NAME_INPUT], 90_000);

    ctx.log("waiting for the signed-in status to reach the page");
    await untilBodyHolds(agentBrowser, ["Sign out"], STATUS_DEADLINE_MS);

    ctx.log("the Account section draws, and says the dead cloud's device list couldn't load");
    const heading = parseEval(await agentBrowser(["eval", ACCOUNT_HEADING]), z.string());
    expect(heading === "drawn", "Settings drew no Account heading");
    await untilBodyHolds(agentBrowser, [DEVICES_UNREACHABLE], STATUS_DEADLINE_MS);

    ctx.log("Delete account… asks for the password, and holds its button until one is typed");
    let dialogOpened = false;
    for (let attempt = 0; attempt < 3 && !dialogOpened; attempt += 1) {
      await agentBrowser([
        "find",
        "role",
        "button",
        "click",
        "--name",
        "Delete account…",
        "--exact",
      ]);
      dialogOpened = await pollUntil(
        async () => parseEval(await agentBrowser(["eval", DELETE_DIALOG_PRESENCE]), z.string()),
        (presence) => presence === "present",
        { deadlineMs: 10_000, describe: () => "no delete dialog", intervalMs: 200 },
      ).then(
        () => true,
        () => false,
      );
    }
    expect(dialogOpened, "the delete-account dialog never opened");
    const untyped = parseEval(await agentBrowser(["eval", DELETE_BUTTON_STATE]), z.string());
    expect(untyped === "disabled", `the dialog's Delete account was ${untyped} before a password`);
    await agentBrowser(["fill", DELETE_PASSWORD, "a password to check"]);
    const deleteClicked = parseEval(await agentBrowser(["eval", CLICK_DELETE]), z.string());
    expect(deleteClicked === "clicked", `the dialog's Delete account was ${deleteClicked}`);

    ctx.log("the dead cloud's refusal shows in the dialog, and the Mac stays signed in");
    await pollUntil(
      async () => parseEval(await agentBrowser(["eval", DELETE_DIALOG_TEXT]), z.string()),
      (text) => text.includes("Could not reach the cloud"),
      {
        deadlineMs: STATUS_DEADLINE_MS,
        describe: (text) => `the dialog never said the cloud was unreachable:\n${text}`,
        intervalMs: 500,
      },
    );
    await agentBrowser(["press", "Escape"]);
    await pollUntil(
      async () => parseEval(await agentBrowser(["eval", DELETE_DIALOG_PRESENCE]), z.string()),
      (presence) => presence === "gone",
      {
        deadlineMs: STATUS_DEADLINE_MS,
        describe: () => "the delete dialog never left the page",
        intervalMs: 100,
      },
    );
    const afterRefusal = await agentBrowser(["get", "text", "body"]);
    expect(
      afterRefusal.includes("Sign out"),
      `a refused deletion took Sign out away:\n${afterRefusal}`,
    );

    // by role, since the unauthorized state's prose carries the words too; retried, because a
    // click that lands before React attaches the handler is lost on a slow runner.
    const openSignOutConfirm = async (): Promise<void> => {
      let opened = false;
      for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
        await agentBrowser(["find", "role", "button", "click", "--name", "Sign out", "--exact"]);
        opened = await agentBrowser(["wait", ALERT_DIALOG], 10_000).then(
          () => true,
          () => false,
        );
      }
      expect(opened, "the Sign out confirm dialog never opened");
    };

    // until then it still covers the page, and still answers "Sign out" by that name
    const confirmLeft = async (): Promise<void> => {
      await pollUntil(
        async () => parseEval(await agentBrowser(["eval", DIALOG_PRESENCE]), z.string()),
        (presence) => presence === "gone",
        {
          deadlineMs: STATUS_DEADLINE_MS,
          describe: () => "the confirm never left the page",
          intervalMs: 100,
        },
      );
    };

    ctx.log("Sign out awaits a confirm: the dialog opens on this route");
    await openSignOutConfirm();
    const dialog = await agentBrowser(["get", "text", ALERT_DIALOG]);
    expect(
      dialog.includes("Stop syncing this device?"),
      `the confirm dialog did not carry the Sign out prompt:\n${dialog}`,
    );
    await agentBrowser(["press", "Escape"]);
    await confirmLeft();

    ctx.log("a refused add toasts on this route");
    await agentBrowser(["fill", NAME_INPUT, CONNECTOR_NAME]);
    await agentBrowser(["fill", URL_INPUT, CONNECTOR_URL]);
    await clickButtonIn(agentBrowser, CONNECTOR_FORM, "Add", 10_000);
    await agentBrowser(["wait", TOAST], 30_000);
    const toastText = await agentBrowser(["get", "text", TOAST]);
    expect(
      toastText.includes(`already has a connector named "${CONNECTOR_NAME}"`),
      `the toast did not carry the refusal:\n${toastText}`,
    );

    ctx.log("signed out, the Account section offers to create an account");
    await openSignOutConfirm();
    // the confirm's own button: the section's Sign out behind the dialog carries the same name.
    await clickButtonIn(agentBrowser, ALERT_DIALOG, "Sign out");
    await confirmLeft();
    await untilBodyHolds(agentBrowser, ["Create an account"], STATUS_DEADLINE_MS);
    await agentBrowser(["find", "role", "button", "click", "--name", "Create an account"]);
    await untilBodyHolds(agentBrowser, ["Invite code"], STATUS_DEADLINE_MS);
    const fields = parseEval(await agentBrowser(["eval", ACCOUNT_FIELDS]), accountFieldsSchema);
    await agentBrowser(["fill", fields.name.selector, NEW_ACCOUNT.name]);
    await agentBrowser(["fill", fields.email.selector, NEW_ACCOUNT.email]);
    await agentBrowser(["fill", fields.password.selector, NEW_ACCOUNT.password]);
    await agentBrowser(["fill", fields.inviteCode.selector, NEW_ACCOUNT.inviteCode]);

    ctx.log("a sign-up the dead cloud cannot answer says so, and keeps what was typed");
    await agentBrowser(["find", "role", "button", "click", "--name", "Create account", "--exact"]);
    await untilBodyHolds(agentBrowser, ["Could not reach the cloud"], STATUS_DEADLINE_MS);
    const kept = parseEval(await agentBrowser(["eval", ACCOUNT_FIELDS]), accountFieldsSchema);
    expect(
      kept.name.value === NEW_ACCOUNT.name &&
        kept.email.value === NEW_ACCOUNT.email &&
        kept.password.value === NEW_ACCOUNT.password &&
        kept.inviteCode.value === NEW_ACCOUNT.inviteCode,
      `the form lost what was typed: ${JSON.stringify(kept)}`,
    );
  },
};
