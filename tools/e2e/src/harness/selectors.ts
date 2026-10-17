// the workspace landmarks more than one scenario waits on or drives.
export const SIDEBAR = '[data-slot="sidebar-wrapper"]';
export const EDITOR = '[data-slate-editor="true"]';
export const COMPOSER = 'textarea[aria-label="Ask the agent"]';
// prefix-matched: the placeholder ends in an ellipsis that is awkward to quote through a shell.
export const PALETTE_INPUT = 'input[placeholder^="Search your library"]';
// the library's grid, which the window opens on: nothing is open at boot.
export const LIBRARY_GRID = '[data-slot="card-grid"]';
// one item's card in the grid.
export const libraryCard = (vaultPath: string): string =>
  `[role="gridcell"][data-item-path="${vaultPath}"]`;
// a folder's row in the rail's Folders group.
export const folderRow = (folder: string): string => `[role="tree"] [data-folder="${folder}"]`;
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
// a click on a card as a pointer makes it, ⌘-click (Ctrl off a Mac) when `toggle`: Finder's grammar,
// which agent-browser's own click cannot hold a modifier for. Answers "clicked" or "missing".
export const clickCard = (vaultPath: string, toggle = false): string => `(() => {
  const card = document.querySelector(${JSON.stringify(libraryCard(vaultPath))});
  if (!card) return "missing";
  const mac = /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
  card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: ${String(toggle)} && mac, ctrlKey: ${String(toggle)} && !mac }));
  card.focus();
  return "clicked";
})()`;
// the open item's breadcrumb way back
export const BACK_TO_LIBRARY = 'button[aria-label="Back to library"]';
// the library's own header, which names the scope shown
export const LIBRARY_TITLE = "[data-library-view] h1";
