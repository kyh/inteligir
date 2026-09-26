import { DEVICE_CREDENTIAL_PREFIX } from "@repo/api/cloud/device/device-schema";
import { writeDeviceCredential } from "inteligir/server/cloud/credential-store";
import { z } from "zod";
import { parseEval } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

// nothing listens on port 1, so every cloud request is refused at once; the credential file alone
// puts Sign out on screen.
const DEAD_CLOUD_URL = "http://127.0.0.1:1";
const CONNECTOR_NAME = "dupe";
const CONNECTOR_URL = "https://mcp.example.com/mcp";
const STATUS_DEADLINE_MS = 30_000;
// the open one: an answered confirm stays in the DOM through its exit animation, and its Sign out
// answers nothing.
const ALERT_DIALOG = '[role="alertdialog"][data-open]';
const DIALOG_PRESENCE = `document.querySelector('[role="alertdialog"]') === null ? "gone" : "present"`;
// the section's own heading, not a row or the nav link that share its word
const ACCOUNT_HEADING = `[...document.querySelectorAll("h3")].some((el) => el.textContent.trim() === "Account") ? "drawn" : "missing"`;
const DEVICES_UNREACHABLE = "Couldn't reach your account to list its devices.";
const TOAST = "[data-sonner-toast]";
// by placeholder: the ids are React-minted per mount.
const NAME_INPUT = 'input[placeholder="context7"]';
const URL_INPUT = `input[placeholder="${CONNECTOR_URL}"]`;
// exact label: `find text` would also match the "Add a connector" heading beside it.
const CLICK_ADD = `(() => {
  const button = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Add");
  if (!button) return "missing";
  if (button.disabled) return "disabled";
  button.click();
  return "clicked";
})()`;

// the confirm's own button: the section's Sign out behind the dialog carries the same name.
const CONFIRM_SIGN_OUT = `(() => {
  const dialog = document.querySelector('${ALERT_DIALOG}');
  const button = dialog ? [...dialog.querySelectorAll("button")].find((el) => el.textContent.trim() === "Sign out") : null;
  if (!button) return "missing";
  button.click();
  return "clicked";
})()`;
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
    "/settings hosts the dialog and the toaster: the Account section says a dead cloud's device list couldn't load, Sign out confirms, a refused add toasts, and signed out a refused sign-up keeps the form",
  name: "settings-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_CLOUD_URL: DEAD_CLOUD_URL, INTELIGIR_SYNC_INTERVAL_MS: "0" },
      name: "solo",
      seedData: (dataDir) => {
        writeDeviceCredential(dataDir, {
          credential: `${DEVICE_CREDENTIAL_PREFIX}${"0".repeat(64)}`,
          deviceId: "dev_settings_e2e",
        });
      },
    });
    // the row the form's add will collide with.
    await app.api.connectors.add({
      name: CONNECTOR_NAME,
      transport: { kind: "http", url: CONNECTOR_URL },
    });

    const agentBrowser = await ctx.browser("settings");

    ctx.log(`opening ${app.baseUrl}/settings`);
    await agentBrowser(["open", await app.browserUrl("/settings")], 60_000);
    await agentBrowser(["wait", NAME_INPUT], 90_000);

    ctx.log("waiting for the signed-in status to reach the page");
    await pollUntil(
      async () => await agentBrowser(["get", "text", "body"]),
      (body) => body.includes("Sign out"),
      {
        deadlineMs: STATUS_DEADLINE_MS,
        describe: (body) => `the Account section never showed Sign out:\n${body}`,
        intervalMs: 500,
      },
    );

    ctx.log("the Account section draws, and says the dead cloud's device list couldn't load");
    const heading = parseEval(await agentBrowser(["eval", ACCOUNT_HEADING]), z.string());
    expect(heading === "drawn", "Settings drew no Account heading");
    await pollUntil(
      async () => await agentBrowser(["get", "text", "body"]),
      (body) => body.includes(DEVICES_UNREACHABLE),
      {
        deadlineMs: STATUS_DEADLINE_MS,
        describe: (body) => `the Account section never said its devices couldn't load:\n${body}`,
        intervalMs: 500,
      },
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
    const clicked = parseEval(await agentBrowser(["eval", CLICK_ADD]), z.string());
    expect(clicked === "clicked", `the Add button was ${clicked}`);
    await agentBrowser(["wait", TOAST], 30_000);
    const toastText = await agentBrowser(["get", "text", TOAST]);
    expect(
      toastText.includes("already exists"),
      `the toast did not carry the refusal:\n${toastText}`,
    );

    ctx.log("signed out, the Account section offers to create an account");
    await openSignOutConfirm();
    const confirmed = parseEval(await agentBrowser(["eval", CONFIRM_SIGN_OUT]), z.string());
    expect(confirmed === "clicked", `the confirm's Sign out was ${confirmed}`);
    await confirmLeft();
    await pollUntil(
      async () => await agentBrowser(["get", "text", "body"]),
      (body) => body.includes("Create an account"),
      {
        deadlineMs: STATUS_DEADLINE_MS,
        describe: (body) => `the signed-out form never offered Create an account:\n${body}`,
        intervalMs: 500,
      },
    );
    await agentBrowser(["find", "role", "button", "click", "--name", "Create an account"]);
    await pollUntil(
      async () => await agentBrowser(["get", "text", "body"]),
      (body) => body.includes("Invite code"),
      {
        deadlineMs: STATUS_DEADLINE_MS,
        describe: (body) => `Create an account never showed an Invite code field:\n${body}`,
        intervalMs: 500,
      },
    );
    const fields = parseEval(await agentBrowser(["eval", ACCOUNT_FIELDS]), accountFieldsSchema);
    await agentBrowser(["fill", fields.name.selector, NEW_ACCOUNT.name]);
    await agentBrowser(["fill", fields.email.selector, NEW_ACCOUNT.email]);
    await agentBrowser(["fill", fields.password.selector, NEW_ACCOUNT.password]);
    await agentBrowser(["fill", fields.inviteCode.selector, NEW_ACCOUNT.inviteCode]);

    ctx.log("a sign-up the dead cloud cannot answer says so, and keeps what was typed");
    await agentBrowser(["find", "role", "button", "click", "--name", "Create account", "--exact"]);
    await pollUntil(
      async () => await agentBrowser(["get", "text", "body"]),
      (body) => body.includes("Could not reach the cloud"),
      {
        deadlineMs: STATUS_DEADLINE_MS,
        describe: (body) => `the refused sign-up never said why:\n${body}`,
        intervalMs: 500,
      },
    );
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
