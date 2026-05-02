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

export { SessionManager } from "@mariozechner/pi-coding-agent";
export type {
  AgentSessionEvent,
  ExtensionAPI,
  ExtensionFactory,
  SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
export type {
  Api,
  ImageContent,
  Message,
  Model,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
