// the library page's landmarks more than one scenario waits on or drives.

// the rail, which draws once the page has opened the library
export const LIBRARY_RAIL = '[data-slot="sidebar-wrapper"] [aria-label="Library"]';
export const EDITOR = '[data-slate-editor="true"]';
// a row of a listbox: the palette's and the editor's menus
export const OPTION = "[role=option]";
export const OPTION_COUNT = `String(document.querySelectorAll('${OPTION}').length)`;
// the palette's field: the one search surface
export const PALETTE_INPUT = 'input[aria-label="Search the library"]';
// the library's grid, which the page opens on: nothing is open at boot
export const LIBRARY_GRID = '[data-slot="card-grid"]';
// one item's card in the grid, by its id
export const libraryCard = (itemId: string): string =>
  `[role="gridcell"][data-item-id="${itemId}"]`;
// a folder's row in the rail's Folders group, by its id
export const folderRow = (folderId: string): string => `[data-folder-id="${folderId}"]`;
export const TOAST = "[data-sonner-toast]";
// every toast's text at once: another may be up beside the one a scenario waits on.
export const TOAST_TEXT = `String([...document.querySelectorAll('${TOAST}')].map((el) => el.textContent).join("\\n"))`;
// a double-click on a card as a pointer makes it: a click, a second click counting two (the one the
// card opens on), none of which agent-browser's own click makes. Answers "opened" or "missing".
export const doubleClickCard = (itemId: string): string => `(() => {
  const card = document.querySelector(${JSON.stringify(`[data-item-id="${itemId}"]`)});
  if (!card) return "missing";
  for (const detail of [1, 2]) {
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
  }
  return "opened";
})()`;
// a click on a card as a pointer makes it. Answers "clicked" or "missing".
export const clickCard = (itemId: string): string => `(() => {
  const card = document.querySelector(${JSON.stringify(`[data-item-id="${itemId}"]`)});
  if (!card) return "missing";
  card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  card.focus();
  return "clicked";
})()`;
// the open item's way back
export const BACK_TO_LIBRARY = 'button[aria-label="Back to the library"]';
// the agent panel's message field
export const COMPOSER = 'textarea[aria-label="Message the agent"]';
