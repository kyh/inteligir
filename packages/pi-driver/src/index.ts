// Public surface of @repo/pi-driver. App code should depend on this barrel
// rather than reaching into pi-coding-agent or pi-ai directly — when those
// SDKs change shape, only this package needs to absorb the diff.

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
