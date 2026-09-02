// kept out of `../types.ts` so the sandboxed chrome preload's bundle carries no zod.
export const BROWSER_IPC = {
  NAVIGATE: "inteligir-browser:navigate",
  BACK: "inteligir-browser:back",
  FORWARD: "inteligir-browser:forward",
  RELOAD: "inteligir-browser:reload",
  SEND_TO_AGENT: "inteligir-browser:send-to-agent",
  STATE: "inteligir-browser:state",
} as const;
