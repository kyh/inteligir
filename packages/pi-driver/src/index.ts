export { PiAgent } from "./agent";
export type {
  PiAgentConfig,
  PiAgentEventListener,
  PiAgentTool,
  PiAgentStatus,
} from "./agent";
export {
  createAuthStorage,
  hasAuth,
  loginWithProvider,
  type LoginCallbacks,
} from "./auth";
export { resolveModel } from "./model";

export type { AgentSessionEvent, ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
export type { Api, ImageContent, Model } from "@mariozechner/pi-ai";
