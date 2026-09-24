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
