// ---------------------------------------------------------------------------
// Wire shapes for the READ-ONLY past-chat browser (session picker). Listing
// and reading are the ONLY operations — there is deliberately no channel to
// resume or continue an arbitrary session: chat stays a single persistent
// thread (resume is continueRecent-only), and a past session is a transcript
// to VIEW, never a thread to re-enter.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

import type { ChatHistoryEntry } from "./chat-log";

/** One past chat thread in the session dir, as listed (newest first). */
export type ChatSessionSummary = {
  /** The pi session id (the session file's header id). */
  id: string;
  /** First user message — note-context prefix stripped, truncated. */
  title: string;
  /** Last-activity epoch ms; the listing sorts on this, newest first. */
  updatedAt: number;
  /** Persisted message-entry count (user + assistant + tool results). */
  messageCount: number;
};

export const ReadChatSessionSchema = Type.Object(
  { id: Type.String() },
  { additionalProperties: false },
);

/** Reading an unknown/malformed id is an error VALUE, not a throw — the
 * browser surfaces it inline instead of crashing the Bridge call. */
export type ReadChatSessionResult =
  | { ok: true; entries: ChatHistoryEntry[] }
  | { ok: false; error: string };
