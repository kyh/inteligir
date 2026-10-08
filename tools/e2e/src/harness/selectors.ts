// the workspace landmarks more than one scenario waits on or drives.
export const SIDEBAR = '[data-slot="sidebar-wrapper"]';
export const COMPOSER = 'textarea[aria-label="Ask the agent"]';
// prefix-matched: the placeholder ends in an ellipsis that is awkward to quote through a shell.
export const PALETTE_INPUT = 'input[placeholder^="Search commands"]';
// the step /welcome draws over the workspace; none once it is finished.
export const WELCOME_STEP = "[data-welcome-step]";
export const welcomeStep = (step: "account"): string => `[data-welcome-step="${step}"]`;
// the open one: an answered confirm stays in the DOM through its exit animation, and its buttons
// answer nothing.
export const ALERT_DIALOG = '[role="alertdialog"][data-open]';
// any confirm at all, the closing one included: until it is gone it still covers the page.
export const DIALOG_PRESENCE = `document.querySelector('[role="alertdialog"]') === null ? "gone" : "present"`;
