// Re-exports of pi-coding-agent / pi-ai types that desktop code reaches for.
// Importing here (rather than directly from the pi-* packages) keeps the
// wrapper stable: if pi swaps an export location, only this file changes.
// (`ModelRuntime` is pi's credential/model handle — see pi/auth.ts.)

export { SessionManager } from "@earendil-works/pi-coding-agent";

// pi's tool-output truncation utilities. Values, not types — but they belong
// here for the same reason SessionManager does: the quarantine is the only
// place allowed to name a pi module, so a wrapper for five re-exports would
// be a file with nothing in it. extension-helpers.ts builds the shared
// `truncatedTextResult` over these; pi's docs/extensions.md ("Tools MUST
// truncate their output") is the contract they implement.
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
export type {
  AgentSessionEvent,
  ExtensionAPI,
  ExtensionFactory,
  ModelRuntime,
  SessionEntry,
  SessionInfo,
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
