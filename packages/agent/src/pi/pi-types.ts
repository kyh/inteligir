// Re-exports of pi-coding-agent / pi-ai types that desktop code reaches for.
// Importing here (rather than directly from the pi-* packages) keeps the
// wrapper stable: if pi swaps an export location, only this file changes.
// (0.80: AuthStorage left the public surface; ModelRuntime is the canonical
// credential/model handle — see pi/auth.ts.)

export { SessionManager } from "@earendil-works/pi-coding-agent";
export type {
  AgentSessionEvent,
  ExtensionAPI,
  ExtensionFactory,
  ModelRuntime,
  SessionMessageEntry,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

export type {
  Api,
  ImageContent,
  Message,
  Model,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
