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
