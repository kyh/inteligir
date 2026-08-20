// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed: the rate-limit snapshot state (and its provider/rateLimits
// events), the goal events, and the sub-agent / collab-agent / dynamic-tool
// item branches are not carried — their schemas were trimmed too, so those
// notifications parse as unhandled and surface as provider/unhandled.
// `translateCodexEvent` is stateless as a result.

import type {
  ThreadEventFileChange,
  ThreadEventItemApprovalStatus,
  ThreadEventItemStatus,
  ThreadEventTurnStatus,
} from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import type {
  ProviderErrorCategory,
  ProviderErrorInfo,
  ProviderEvent,
  ProviderErrorEvent,
  ProviderEventCommandExecutionItem,
  ProviderEventContextWindowUsage,
  ProviderEventItem,
  ProviderEventToolCallItem,
  ProviderEventUserContent,
  ProviderEventWebFetchItem,
  ProviderEventWebSearchItem,
  ProviderToolCallProgressEvent,
  ProviderTurnCompletedEvent,
  ProviderTurnPlanUpdatedEvent,
  ProviderWarningEvent,
} from "../vocabulary/provider-event.js";
import { jsonObjectSchema } from "../vocabulary/json-value.js";
import {
  createUnhandledProviderEvent,
  type CreateUnhandledProviderEventArgs,
} from "../shared/provider-unhandled-event.js";
import { UNSTAMPED_THREAD_ID } from "../shared/unstamped-thread-id.js";
import type { JsonRpcMessage, ProviderRuntimeEvent } from "../runtime-json-rpc.js";
import {
  codexBridgeEnvelopeSchema,
  codexHandledEventSchema,
  codexHandledThreadItemSchema,
  isHandledCodexMethod,
  type CodexErrorInfo,
  type CodexHandledEvent,
  type CodexHandledThreadItem,
  type CodexItemStatus,
  type CodexParsedUserInput,
  type CodexThreadItemEnvelope,
  type CodexTurnStatus,
} from "./schemas.js";
import { codexVisibilityMetadata } from "./visibility.js";

function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

interface CodexLastTokenUsage {
  totalTokens: number;
}

type CodexNormalizedWebItem = ProviderEventWebSearchItem | ProviderEventWebFetchItem;

type CodexErrorEvent = Extract<CodexHandledEvent, { method: "error" }>;
type CodexErrorPayload = CodexErrorEvent["params"]["error"];

type CodexItemTranslationResult =
  | { kind: "translated"; item: ProviderEventItem }
  | { kind: "ignored" }
  | { kind: "unhandled" };

function toCodexContextWindowUsage(
  lastTokenUsage: CodexLastTokenUsage,
  modelContextWindow: number | null,
): ProviderEventContextWindowUsage {
  return {
    usedTokens: lastTokenUsage.totalTokens,
    modelContextWindow,
    estimated: false,
  };
}

function getProviderErrorCategory(kind: CodexErrorInfo["kind"]): ProviderErrorCategory {
  switch (kind) {
    case "contextWindowExceeded":
      return "context-window-exceeded";
    case "usageLimitExceeded":
      return "rate-limit";
    case "serverOverloaded":
      return "overloaded";
    case "cyberPolicy":
      return "policy";
    case "internalServerError":
      return "internal";
    case "unauthorized":
      return "unauthorized";
    case "badRequest":
      return "bad-request";
    case "threadRollbackFailed":
      return "thread-rollback-failed";
    case "sandboxError":
      return "sandbox";
    case "other":
      return "unknown";
    case "httpConnectionFailed":
      return "connection-failed";
    case "responseStreamConnectionFailed":
      return "connection-failed";
    case "responseStreamDisconnected":
      return "stream-disconnected";
    case "responseTooManyFailedAttempts":
      return "too-many-failed-attempts";
    case "activeTurnNotSteerable":
      return "active-turn-not-steerable";
    default:
      return assertNever(kind);
  }
}

function toProviderErrorInfo(error: CodexErrorPayload): ProviderErrorInfo | null {
  const errorInfo = error.codexErrorInfo;
  if (!errorInfo) {
    return null;
  }
  return {
    category: getProviderErrorCategory(errorInfo.kind),
    providerCode: errorInfo.kind,
    httpStatusCode: errorInfo.httpStatusCode,
  };
}

interface CodexUnhandledEventArgs {
  rawEvent: JsonRpcMessage;
  rawType?: string;
  threadId?: string;
  providerThreadId?: string;
  turnId?: string;
}

function buildUnhandledCodexEvent(args: CodexUnhandledEventArgs): ProviderEvent[] {
  const description = codexVisibilityMetadata.describeRawEvent(args.rawEvent);
  if (description.coverage !== "unknown" && args.rawType === undefined) {
    return [];
  }

  const unhandled: CreateUnhandledProviderEventArgs = {
    providerId: "codex",
    rawEvent: args.rawEvent,
    rawType: args.rawType ?? description.kind,
  };
  if (args.threadId) unhandled.threadId = args.threadId;
  if (args.providerThreadId) unhandled.providerThreadId = args.providerThreadId;
  if (args.turnId) unhandled.turnId = args.turnId;

  return [createUnhandledProviderEvent(unhandled)];
}

/** Codex reports both warning kinds with the same params, and neither is
 *  scoped to a thread the host has stamped yet. */
function buildCodexWarning(
  category: ProviderWarningEvent["category"],
  summary: string,
  details: string | null | undefined,
): ProviderWarningEvent {
  const warning: ProviderWarningEvent = {
    type: "provider/warning",
    threadId: UNSTAMPED_THREAD_ID,
    providerThreadId: "",
    scope: threadScope(),
    category,
    summary,
  };
  if (details) warning.details = details;
  return warning;
}

function toTurnStatus(status: CodexTurnStatus): ThreadEventTurnStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "inProgress":
      return "completed";
    default:
      return assertNever(status);
  }
}

function toItemStatus(status: CodexItemStatus): ThreadEventItemStatus {
  switch (status) {
    case "inProgress":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "declined":
      return "interrupted";
    default:
      return assertNever(status);
  }
}

function toApprovalStatus(
  status: CodexItemStatus,
  eventMethod: "item/started" | "item/completed",
): ThreadEventItemApprovalStatus {
  // A started event is not terminal even if Codex includes a terminal-looking
  // status. Only completed declined items represent a denied approval/policy.
  if (eventMethod === "item/completed" && status === "declined") {
    return "denied";
  }
  return null;
}

function translateCodexUserContent(content: CodexParsedUserInput): ProviderEventUserContent {
  switch (content.type) {
    case "text":
      return { type: "text", text: content.text };
    case "image":
      return { type: "image", url: content.url };
    case "localImage":
      return { type: "localImage", path: content.path };
    case "skill":
    case "mention":
      return { type: "text", text: `[${content.type}: ${content.name}]` };
    default:
      return assertNever(content);
  }
}

function collectNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return values.flatMap((value) => (value != null && value.length > 0 ? [value] : []));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

interface CodexSearchQueriesArgs {
  itemQuery: string;
  actionQuery: string | null | undefined;
  actionQueries: string[] | null | undefined;
}

function normalizeCodexSearchQueries(args: CodexSearchQueriesArgs): string[] | null {
  const queries = dedupeStrings(
    collectNonEmptyStrings([...(args.actionQueries ?? []), args.actionQuery, args.itemQuery]),
  );
  return queries.length > 0 ? queries : null;
}

interface CodexUrlArgs {
  actionUrl: string | null | undefined;
}

function normalizeCodexUrl(args: CodexUrlArgs): string | null {
  const url = collectNonEmptyStrings([args.actionUrl])[0];
  return url ?? null;
}

function normalizeCodexWebItem(
  item: Extract<CodexHandledThreadItem, { type: "webSearch" }>,
): CodexNormalizedWebItem | null {
  if (!item.action) {
    return null;
  }

  switch (item.action.type) {
    case "search": {
      const queries = normalizeCodexSearchQueries({
        itemQuery: item.query,
        actionQuery: item.action.query,
        actionQueries: item.action.queries,
      });
      if (!queries) {
        return null;
      }
      return {
        type: "webSearch",
        id: item.id,
        queries,
        resultText: null,
      };
    }
    case "openPage": {
      const url = normalizeCodexUrl({ actionUrl: item.action.url });
      if (!url) {
        return null;
      }
      return {
        type: "webFetch",
        id: item.id,
        url,
        prompt: null,
        pattern: null,
        resultText: null,
      };
    }
    case "findInPage": {
      const url = normalizeCodexUrl({ actionUrl: item.action.url });
      if (!url) {
        return null;
      }
      return {
        type: "webFetch",
        id: item.id,
        url,
        prompt: null,
        pattern: item.action.pattern ?? null,
        resultText: null,
      };
    }
    case "other":
      return null;
    default:
      return assertNever(item.action);
  }
}

function shouldIgnoreCodexWebItem(
  item: Extract<CodexHandledThreadItem, { type: "webSearch" }>,
): boolean {
  return item.action === null || item.action.type === "other";
}

function translateCodexItem(
  item: CodexThreadItemEnvelope,
  eventMethod: "item/started" | "item/completed",
): CodexItemTranslationResult {
  const parsed = codexHandledThreadItemSchema.safeParse(item);
  if (!parsed.success) {
    return { kind: "unhandled" };
  }

  const parsedItem: CodexHandledThreadItem = parsed.data;
  const isStartedEvent = eventMethod === "item/started";
  switch (parsedItem.type) {
    case "agentMessage":
      return {
        kind: "translated",
        item: {
          type: "agentMessage",
          id: parsedItem.id,
          text: parsedItem.text,
        },
      };
    case "userMessage": {
      const content = parsedItem.content
        .map((entry) => translateCodexUserContent(entry))
        .filter((entry) => entry.type !== "text" || entry.text.length > 0);
      return {
        kind: "translated",
        item: { type: "userMessage", id: parsedItem.id, content },
      };
    }
    case "commandExecution": {
      const item: ProviderEventCommandExecutionItem = {
        type: "commandExecution",
        id: parsedItem.id,
        command: parsedItem.command,
        cwd: parsedItem.cwd,
        status: isStartedEvent ? "pending" : toItemStatus(parsedItem.status),
        approvalStatus: toApprovalStatus(parsedItem.status, eventMethod),
      };
      if (parsedItem.aggregatedOutput !== null) item.aggregatedOutput = parsedItem.aggregatedOutput;
      if (parsedItem.exitCode !== null) item.exitCode = parsedItem.exitCode;
      if (parsedItem.durationMs !== null) item.durationMs = parsedItem.durationMs;
      return { kind: "translated", item };
    }
    case "fileChange":
      return {
        kind: "translated",
        item: {
          type: "fileChange",
          id: parsedItem.id,
          changes: parsedItem.changes.map((change) => {
            const fileChange: ThreadEventFileChange = {
              path: change.path,
              kind: change.kind.type,
            };
            if (change.kind.type === "update" && change.kind.move_path) {
              fileChange.movePath = change.kind.move_path;
            }
            if (change.diff) fileChange.diff = change.diff;
            return fileChange;
          }),
          status: isStartedEvent ? "pending" : toItemStatus(parsedItem.status),
          approvalStatus: toApprovalStatus(parsedItem.status, eventMethod),
        },
      };
    case "mcpToolCall": {
      const toolArguments = jsonObjectSchema.safeParse(parsedItem.arguments);
      const errorMessage = parsedItem.error?.message;
      const item: ProviderEventToolCallItem = {
        type: "toolCall",
        id: parsedItem.id,
        server: parsedItem.server,
        tool: parsedItem.tool,
        status: isStartedEvent ? "pending" : toItemStatus(parsedItem.status),
      };
      if (toolArguments.success) item.arguments = toolArguments.data;
      if (errorMessage !== undefined) item.error = errorMessage;
      if (parsedItem.durationMs !== null) item.durationMs = parsedItem.durationMs;
      return { kind: "translated", item };
    }
    case "webSearch": {
      if (shouldIgnoreCodexWebItem(parsedItem)) {
        return { kind: "ignored" };
      }
      const normalized = normalizeCodexWebItem(parsedItem);
      return normalized ? { kind: "translated", item: normalized } : { kind: "unhandled" };
    }
    case "imageView":
      return {
        kind: "translated",
        item: {
          type: "imageView",
          id: parsedItem.id,
          path: parsedItem.path,
        },
      };
    case "reasoning":
      return {
        kind: "translated",
        item: {
          type: "reasoning",
          id: parsedItem.id,
          summary: parsedItem.summary,
          content: parsedItem.content,
        },
      };
    case "plan":
      return {
        kind: "translated",
        item: {
          type: "plan",
          id: parsedItem.id,
          text: parsedItem.text,
        },
      };
    case "contextCompaction":
      return {
        kind: "translated",
        item: {
          type: "contextCompaction",
          id: parsedItem.id,
        },
      };
    default:
      return assertNever(parsedItem);
  }
}

export function translateCodexEvent(event: ProviderRuntimeEvent): ProviderEvent[] {
  const envelope = codexBridgeEnvelopeSchema.safeParse(event);
  if (!envelope.success) {
    return [];
  }

  const rawEvent: JsonRpcMessage = {
    jsonrpc: "2.0",
    method: envelope.data.method,
  };
  if (envelope.data.params) rawEvent.params = envelope.data.params;

  const parsed = codexHandledEventSchema.safeParse(rawEvent);
  if (!parsed.success) {
    return isHandledCodexMethod(rawEvent.method)
      ? buildUnhandledCodexEvent({ rawEvent, rawType: rawEvent.method })
      : buildUnhandledCodexEvent({ rawEvent });
  }

  const handledEvent: CodexHandledEvent = parsed.data;
  switch (handledEvent.method) {
    case "turn/started":
      return [
        {
          type: "turn/started",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turn.id),
        },
      ];
    case "turn/completed": {
      const completed: ProviderTurnCompletedEvent = {
        type: "turn/completed",
        threadId: handledEvent.params.threadId,
        providerThreadId: handledEvent.params.threadId,
        scope: turnScope(handledEvent.params.turn.id),
        status: toTurnStatus(handledEvent.params.turn.status),
      };
      const errorMessage = handledEvent.params.turn.error?.message;
      if (errorMessage) completed.error = { message: errorMessage };
      return [completed];
    }
    case "thread/started": {
      const events: ProviderEvent[] = [
        {
          type: "thread/started",
          threadId: handledEvent.params.thread.id,
          scope: threadScope(),
        },
        {
          type: "thread/identity",
          threadId: handledEvent.params.thread.id,
          providerThreadId: handledEvent.params.thread.id,
          scope: threadScope(),
        },
      ];
      if (handledEvent.params.thread.preview) {
        events.push({
          type: "thread/name/updated",
          threadId: handledEvent.params.thread.id,
          providerThreadId: handledEvent.params.thread.id,
          scope: threadScope(),
          threadName: handledEvent.params.thread.preview,
        });
      }
      return events;
    }
    case "thread/name/updated":
      return handledEvent.params.threadName
        ? [
            {
              type: "thread/name/updated",
              threadId: handledEvent.params.threadId,
              providerThreadId: handledEvent.params.threadId,
              scope: threadScope(),
              threadName: handledEvent.params.threadName,
            },
          ]
        : [];
    case "thread/compacted":
      return [
        {
          type: "thread/compacted",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
        },
      ];
    case "item/started":
    case "item/completed": {
      const translation = translateCodexItem(handledEvent.params.item, handledEvent.method);
      if (translation.kind === "ignored") {
        return [];
      }
      if (translation.kind === "unhandled") {
        return buildUnhandledCodexEvent({
          rawEvent,
          rawType: handledEvent.method,
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          turnId: handledEvent.params.turnId,
        });
      }
      return [
        {
          type: handledEvent.method,
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          item: translation.item,
        },
      ];
    }
    case "item/agentMessage/delta":
      return [
        {
          type: "item/agentMessage/delta",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          itemId: handledEvent.params.itemId,
          delta: handledEvent.params.delta,
        },
      ];
    case "item/commandExecution/outputDelta":
      return [
        {
          type: "item/commandExecution/outputDelta",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          itemId: handledEvent.params.itemId,
          delta: handledEvent.params.delta,
        },
      ];
    case "item/fileChange/outputDelta":
      return [
        {
          type: "item/fileChange/outputDelta",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          itemId: handledEvent.params.itemId,
          delta: handledEvent.params.delta,
        },
      ];
    case "item/reasoning/summaryTextDelta":
      return [
        {
          type: "item/reasoning/summaryTextDelta",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          itemId: handledEvent.params.itemId,
          delta: handledEvent.params.delta,
        },
      ];
    case "item/reasoning/textDelta":
      return [
        {
          type: "item/reasoning/textDelta",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          itemId: handledEvent.params.itemId,
          delta: handledEvent.params.delta,
        },
      ];
    case "item/plan/delta":
      return [
        {
          type: "item/plan/delta",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          itemId: handledEvent.params.itemId,
          delta: handledEvent.params.delta,
        },
      ];
    case "item/mcpToolCall/progress": {
      const progress: ProviderToolCallProgressEvent = {
        type: "item/toolCall/progress",
        threadId: handledEvent.params.threadId,
        providerThreadId: handledEvent.params.threadId,
        scope: turnScope(handledEvent.params.turnId),
        itemId: handledEvent.params.itemId,
      };
      if (handledEvent.params.message) progress.message = handledEvent.params.message;
      return [progress];
    }
    case "thread/tokenUsage/updated":
      return [
        {
          type: "thread/tokenUsage/updated",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          tokenUsage: {
            total: {
              totalTokens: handledEvent.params.tokenUsage.total.totalTokens,
              inputTokens: handledEvent.params.tokenUsage.total.inputTokens,
              cachedInputTokens: handledEvent.params.tokenUsage.total.cachedInputTokens,
              outputTokens: handledEvent.params.tokenUsage.total.outputTokens,
              reasoningOutputTokens: handledEvent.params.tokenUsage.total.reasoningOutputTokens,
            },
            last: {
              totalTokens: handledEvent.params.tokenUsage.last.totalTokens,
              inputTokens: handledEvent.params.tokenUsage.last.inputTokens,
              cachedInputTokens: handledEvent.params.tokenUsage.last.cachedInputTokens,
              outputTokens: handledEvent.params.tokenUsage.last.outputTokens,
              reasoningOutputTokens: handledEvent.params.tokenUsage.last.reasoningOutputTokens,
            },
            modelContextWindow: handledEvent.params.tokenUsage.modelContextWindow,
          },
        },
        {
          type: "thread/contextWindowUsage/updated",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          contextWindowUsage: toCodexContextWindowUsage(
            handledEvent.params.tokenUsage.last,
            handledEvent.params.tokenUsage.modelContextWindow,
          ),
        },
      ];
    case "turn/plan/updated": {
      const planUpdated: ProviderTurnPlanUpdatedEvent = {
        type: "turn/plan/updated",
        threadId: handledEvent.params.threadId,
        providerThreadId: handledEvent.params.threadId,
        scope: turnScope(handledEvent.params.turnId),
        plan: handledEvent.params.plan.map((step) => ({
          step: step.step,
          status: step.status === "inProgress" ? "active" : step.status,
        })),
      };
      if (handledEvent.params.explanation) {
        planUpdated.explanation = handledEvent.params.explanation;
      }
      return [planUpdated];
    }
    case "turn/diff/updated":
      return [
        {
          type: "turn/diff/updated",
          threadId: handledEvent.params.threadId,
          providerThreadId: handledEvent.params.threadId,
          scope: turnScope(handledEvent.params.turnId),
          diff: handledEvent.params.diff,
        },
      ];
    case "error": {
      const errorInfo = toProviderErrorInfo(handledEvent.params.error);
      const providerError: ProviderErrorEvent = {
        type: "provider/error",
        threadId: handledEvent.params.threadId,
        providerThreadId: handledEvent.params.threadId,
        scope: handledEvent.params.turnId ? turnScope(handledEvent.params.turnId) : threadScope(),
        message: "Provider error",
        detail: handledEvent.params.error.additionalDetails
          ? `${handledEvent.params.error.message}\n${handledEvent.params.error.additionalDetails}`
          : handledEvent.params.error.message,
      };
      if (handledEvent.params.willRetry !== undefined) {
        providerError.willRetry = handledEvent.params.willRetry;
      }
      if (errorInfo) providerError.errorInfo = errorInfo;
      return [providerError];
    }
    case "deprecationNotice":
      return [
        buildCodexWarning("deprecation", handledEvent.params.summary, handledEvent.params.details),
      ];
    case "configWarning":
      return [
        buildCodexWarning("config", handledEvent.params.summary, handledEvent.params.details),
      ];
    default:
      return assertNever(handledEvent);
  }
}
