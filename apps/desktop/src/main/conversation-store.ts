import { ConversationEntrySchema, type ConversationEntry } from "../shared/conversation";
import { inteligirPath, appendJsonl, readJsonl, clearFile } from "./json-store";

// ---------------------------------------------------------------------------
// Single conversation persistence — ~/.inteligir/conversation.jsonl
// ---------------------------------------------------------------------------

const CONVERSATION_PATH = inteligirPath("conversation.jsonl");

export function appendEntry(entry: ConversationEntry): void {
  appendJsonl(CONVERSATION_PATH, entry);
}

export function readEntries(): ConversationEntry[] {
  return readJsonl(CONVERSATION_PATH, ConversationEntrySchema);
}

export function clearConversation(): void {
  clearFile(CONVERSATION_PATH);
}
