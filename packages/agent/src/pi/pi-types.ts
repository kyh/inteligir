// Re-exports of pi-coding-agent / pi-ai types that desktop code reaches for.
// Importing here (rather than directly from the pi-* packages) keeps the
// wrapper stable: if pi swaps an export location, only this file changes.

export { SessionManager } from "@mariozechner/pi-coding-agent";
export type {
  AgentSessionEvent,
  AuthStorage,
  ExtensionAPI,
  ExtensionFactory,
  SessionMessageEntry,
  ToolCallEvent,
  ToolCallEventResult,
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
