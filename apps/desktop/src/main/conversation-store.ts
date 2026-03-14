import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { ConversationEntrySchema, type ConversationEntry } from "../shared/conversation";

// ---------------------------------------------------------------------------
// Single conversation persistence — ~/.inteligir/conversation.jsonl
// ---------------------------------------------------------------------------

const INTELIGIR_DIR = path.join(os.homedir(), ".inteligir");
const CONVERSATION_PATH = path.join(INTELIGIR_DIR, "conversation.jsonl");

function ensureDir(): void {
  fs.mkdirSync(INTELIGIR_DIR, { recursive: true });
}

export function appendEntry(entry: ConversationEntry): void {
  ensureDir();
  fs.appendFileSync(CONVERSATION_PATH, JSON.stringify(entry) + "\n", "utf8");
}

export function readEntries(): ConversationEntry[] {
  if (!fs.existsSync(CONVERSATION_PATH)) return [];

  const lines = fs.readFileSync(CONVERSATION_PATH, "utf8").split("\n").filter(Boolean);
  const entries: ConversationEntry[] = [];

  for (const line of lines) {
    try {
      const result = ConversationEntrySchema.safeParse(JSON.parse(line));
      if (result.success) entries.push(result.data);
    } catch {
      // skip
    }
  }

  return entries;
}

export function clearConversation(): void {
  ensureDir();
  fs.writeFileSync(CONVERSATION_PATH, "", "utf8");
}
