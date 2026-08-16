// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed: `buildUnhandledProviderEvents` (the bridge adapters' wrapper) is
// gone — the codex path calls `createUnhandledProviderEvent` directly.

/**
 * Shared fallback helper for provider events that do not yet have a
 * first-class translation path.
 */

import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import {
  providerRawEventSchema,
  type ProviderRawEvent,
  type ThreadEvent,
} from "../domain/provider-event.js";
import type { JsonRpcMessage } from "../runtime-json-rpc.js";
import { getStringProperty, isRecord } from "./provider-visibility-helpers.js";
import { UNSTAMPED_THREAD_ID } from "./unstamped-thread-id.js";

type ProviderUnhandledEvent = Extract<ThreadEvent, { type: "provider/unhandled" }>;

export interface CreateUnhandledProviderEventArgs {
  providerId: string;
  rawEvent: JsonRpcMessage;
  rawType: string;
  threadId?: string;
  providerThreadId?: string;
  turnId?: string;
}

function toProviderRawEvent(rawEvent: JsonRpcMessage): ProviderRawEvent {
  const parsed = providerRawEventSchema.safeParse(rawEvent);
  if (parsed.success) {
    return parsed.data;
  }

  return {
    jsonrpc: "2.0",
    ...(rawEvent.id !== undefined ? { id: rawEvent.id } : {}),
    method: rawEvent.method,
    params: {
      serializationError: "Provider raw event params were not JSON-serializable.",
    },
  };
}

function getThreadIdFromRawEvent(rawEvent: JsonRpcMessage): string {
  if (!isRecord(rawEvent.params)) {
    return UNSTAMPED_THREAD_ID;
  }
  return getStringProperty(rawEvent.params, "threadId") ?? UNSTAMPED_THREAD_ID;
}

export function createUnhandledProviderEvent(
  args: CreateUnhandledProviderEventArgs,
): ProviderUnhandledEvent {
  const threadId = args.threadId ?? getThreadIdFromRawEvent(args.rawEvent);
  const providerThreadId = args.providerThreadId ?? threadId;
  // Only a turn id the caller vouched for — one the host itself opened and can
  // therefore be trusted to have a stored turn/started — may scope this event.
  // A provider labels its own internal traffic with turn ids of its own making
  // (Codex tags automatic-compaction events "auto-compact-N"), and callers omit
  // `turnId` precisely when no active turn is known, so reading one out of the
  // raw event would scope the event to a turn that never existed.
  const turnId = args.turnId;

  return {
    type: "provider/unhandled",
    threadId,
    providerThreadId,
    providerId: args.providerId,
    rawType: args.rawType,
    rawEvent: toProviderRawEvent(args.rawEvent),
    scope: turnId !== undefined ? turnScope(turnId) : threadScope(),
  };
}
