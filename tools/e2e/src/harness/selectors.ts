// the workspace landmarks more than one scenario waits on or drives.
export const SIDEBAR = '[data-slot="sidebar-wrapper"]';
export const EDITOR = '[data-slate-editor="true"]';
export const COMPOSER = 'textarea[aria-label="Ask the agent"]';
// prefix-matched: the placeholder ends in an ellipsis that is awkward to quote through a shell.
export const PALETTE_INPUT = 'input[placeholder^="Search notes"]';
// a note or folder in the rail's Files view, which a fresh profile opens on.
export const treeRow = (vaultPath: string): string => `[role="tree"] [data-path="${vaultPath}"]`;
export const OPTION = "[role=option]";
export const OPTION_COUNT = `String(document.querySelectorAll('${OPTION}').length)`;
// the step /welcome draws over the workspace after a first run; none once it is finished.
export const WELCOME_STEP = "[data-welcome-step]";
export const welcomeStep = (step: "agent" | "account"): string => `[data-welcome-step="${step}"]`;
export const TOAST = "[data-sonner-toast]";
// every toast's text at once: another may be up beside the one a scenario waits on.
export const TOAST_TEXT = `String([...document.querySelectorAll('${TOAST}')].map((el) => el.textContent).join("\\n"))`;
// the action of the toast saying `toastText`, found by that text; answers "clicked" or "missing".
export const clickToastAction = (toastText: string): string => `(() => {
  const toast = [...document.querySelectorAll('${TOAST}')].find((el) => el.textContent.includes(${JSON.stringify(toastText)}));
  const button = toast ? toast.querySelector("[data-action]") : null;
  if (!button) return "missing";
  button.click();
  return "clicked";
})()`;
// the hand-written connector's form in Settings: the presets above it carry Add buttons of their
// own. by placeholder inside it, since the ids are React-minted per mount.
export const CONNECTOR_FORM = 'form[aria-label="Another connector"]';
export const NAME_INPUT = `${CONNECTOR_FORM} input[placeholder="my-connector"]`;
export const URL_INPUT = `${CONNECTOR_FORM} input[placeholder="https://example.com"]`;
// the open one: an answered confirm stays in the DOM through its exit animation, and its buttons
// answer nothing.
export const ALERT_DIALOG = '[role="alertdialog"][data-open]';
// any confirm at all, the closing one included: until it is gone it still covers the page.
export const DIALOG_PRESENCE = `document.querySelector('[role="alertdialog"]') === null ? "gone" : "present"`;
