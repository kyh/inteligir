import { z } from "zod";

// ---------------------------------------------------------------------------
// Conversation entry — single JSONL file at ~/.inteligir/conversation.jsonl
// ---------------------------------------------------------------------------

export const ConversationEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), text: z.string(), timestamp: z.number() }),
  z.object({ kind: z.literal("assistant"), text: z.string(), timestamp: z.number() }),
  z.object({ kind: z.literal("steer"), text: z.string(), timestamp: z.number() }),
  z.object({
    kind: z.literal("tool"),
    toolCallId: z.string(),
    toolName: z.string(),
    isError: z.boolean(),
    resultText: z.string(),
    timestamp: z.number(),
  }),
]);

export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;
