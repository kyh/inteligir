// The in-app browser window's IPC channel names, in ONE module both halves
// import — the same one-spelling discipline `../types.ts` states for the app
// window, kept out of that (zod-carrying) module so the sandboxed chrome
// preload's bundle stays minimal. A typo'd rename would otherwise make a verb
// silently dead: an invoke to an unhandled channel just rejects.
export const BROWSER_IPC = {
  NAVIGATE: "inteligir-browser:navigate",
  BACK: "inteligir-browser:back",
  FORWARD: "inteligir-browser:forward",
  RELOAD: "inteligir-browser:reload",
  SEND_TO_AGENT: "inteligir-browser:send-to-agent",
  STATE: "inteligir-browser:state",
} as const;
