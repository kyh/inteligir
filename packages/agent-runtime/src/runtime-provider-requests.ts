// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed: the dynamic-tool-call half is not carried (no dynamic tools are
// registered), so an inbound provider request is either an interactive
// (approval) request or an unsupported method.

import type { ChildProcess } from "node:child_process";
import type { AgentRuntimeExecutionOptions, AgentRuntimeOptions } from "./types.js";
import {
  isApprovalPendingInteractionPayload,
  type PendingInteractionCreate,
  type PendingInteractionPayload,
  type PendingInteractionResolution,
} from "./domain/pending-interactions.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import {
  type JsonRpcMessage,
  ProviderResponseEncodeError,
  sendJsonRpcError,
  sendJsonRpcResult,
  sendProviderRequestDecodeErrorIfKnown,
  sendProviderResponseEncodeErrorIfKnown,
} from "./runtime-json-rpc.js";
import { shouldAutoDenyInteractiveRequest } from "./shared/permission-policy.js";

type RuntimeProviderRequestKind = "interactive request";

interface RuntimeProviderRequestProcess {
  adapter: ProviderAdapter;
  child: ChildProcess;
  interactiveRequestScope: string;
}

export interface ResolveRuntimeProviderRequestThreadIdArgs {
  parsedId: string | number;
  providerThreadId: string;
  requestKind: RuntimeProviderRequestKind;
  threadIdHint: string | undefined;
}

interface RuntimeProviderRequestArgs {
  parsedId: string | number;
  parsedMethod: string;
  providerProcess: RuntimeProviderRequestProcess;
  rawRequest: JsonRpcMessage;
}

export interface HandleRuntimeProviderRequestArgs extends RuntimeProviderRequestArgs {
  getActiveTurnId: (threadId: string) => string | null;
  getThreadExecutionOptions: (threadId: string) => AgentRuntimeExecutionOptions | undefined;
  onInteractiveRequest: AgentRuntimeOptions["onInteractiveRequest"];
  resolveThreadId: (args: ResolveRuntimeProviderRequestThreadIdArgs) => string | null;
}

interface ResolveRuntimeProviderRequestTurnIdArgs extends HandleRuntimeProviderRequestArgs {
  requestKind: RuntimeProviderRequestKind;
  resolvedThreadId: string;
  turnId: string | null;
}

interface ExplicitProviderRequestTurnId {
  kind: "explicit";
  turnId: string;
}

interface UnresolvedProviderRequestTurnId {
  kind: "unresolved";
}

interface InvalidProviderRequestTurnId {
  kind: "invalid";
  message: string;
}

type ProviderRequestTurnIdWireValue =
  | ExplicitProviderRequestTurnId
  | UnresolvedProviderRequestTurnId
  | InvalidProviderRequestTurnId;

function scopeProviderRequestId(scope: string, requestId: string | number): string {
  return `${scope}:${String(requestId)}`;
}

function buildDeniedInteractiveResolution(
  payload: PendingInteractionPayload,
): PendingInteractionResolution {
  if (!isApprovalPendingInteractionPayload(payload)) {
    throw new ProviderResponseEncodeError(
      "User-question interactive requests cannot be auto-denied",
    );
  }
  if (!payload.availableDecisions.includes("deny")) {
    throw new ProviderResponseEncodeError(
      "Interactive request cannot be auto-denied because deny is unavailable",
    );
  }
  return {
    decision: "deny",
  };
}

function classifyProviderRequestTurnIdWireValue(
  turnId: string | null,
): ProviderRequestTurnIdWireValue {
  if (turnId === null) {
    return { kind: "unresolved" };
  }
  if (turnId.length === 0) {
    return {
      kind: "invalid",
      message:
        "Provider request turnId must be a non-empty string when known; use null when unresolved",
    };
  }
  return { kind: "explicit", turnId };
}

function resolveRuntimeProviderRequestTurnId(
  args: ResolveRuntimeProviderRequestTurnIdArgs,
): string | null {
  const providerTurnId = classifyProviderRequestTurnIdWireValue(args.turnId);
  if (providerTurnId.kind === "invalid") {
    sendJsonRpcError({
      child: args.providerProcess.child,
      id: args.parsedId,
      message: providerTurnId.message,
    });
    return null;
  }
  if (providerTurnId.kind === "explicit") {
    return providerTurnId.turnId;
  }

  const activeTurnId = args.getActiveTurnId(args.resolvedThreadId);
  if (activeTurnId !== null) {
    return activeTurnId;
  }

  sendJsonRpcError({
    child: args.providerProcess.child,
    id: args.parsedId,
    message: `Cannot route provider ${args.requestKind} for thread "${args.resolvedThreadId}" without a turn id because no active turn is known`,
  });
  return null;
}

function handleInteractiveProviderRequest(args: HandleRuntimeProviderRequestArgs): boolean {
  const adapter = args.providerProcess.adapter;
  const providerId = adapter.id;
  const decodeInteractiveRequest = adapter.decodeInteractiveRequest?.bind(adapter);
  if (!decodeInteractiveRequest) {
    return false;
  }

  let interactiveReq: ReturnType<typeof decodeInteractiveRequest>;
  try {
    interactiveReq = decodeInteractiveRequest(args.rawRequest);
  } catch (error) {
    if (
      sendProviderRequestDecodeErrorIfKnown({
        child: args.providerProcess.child,
        error,
        id: args.parsedId,
      })
    ) {
      return true;
    }
    throw error;
  }
  if (!interactiveReq) {
    return false;
  }

  const resolvedThreadId = args.resolveThreadId({
    parsedId: args.parsedId,
    providerThreadId: interactiveReq.providerThreadId,
    requestKind: "interactive request",
    threadIdHint: interactiveReq.threadId,
  });
  if (!resolvedThreadId) {
    return true;
  }
  const buildInteractiveResponse = adapter.buildInteractiveResponse?.bind(adapter);
  if (!buildInteractiveResponse) {
    sendJsonRpcError({
      child: args.providerProcess.child,
      id: args.parsedId,
      message: `Provider "${providerId}" cannot encode interactive response for "${interactiveReq.method}"`,
    });
    return true;
  }
  const resolvedTurnId = resolveRuntimeProviderRequestTurnId({
    ...args,
    requestKind: "interactive request",
    resolvedThreadId,
    turnId: interactiveReq.turnId,
  });
  if (resolvedTurnId === null) {
    return true;
  }
  const resolvedInteractiveReq = {
    ...interactiveReq,
    turnId: resolvedTurnId,
  };

  const scopedInteractiveReq: PendingInteractionCreate = {
    threadId: resolvedThreadId,
    turnId: resolvedTurnId,
    providerId,
    providerThreadId: interactiveReq.providerThreadId,
    providerRequestId: scopeProviderRequestId(
      args.providerProcess.interactiveRequestScope,
      interactiveReq.requestId,
    ),
    payload: interactiveReq.payload,
  };

  const isApprovalRequest = isApprovalPendingInteractionPayload(interactiveReq.payload);
  const runtimeOwnsApprovalPolicy =
    args.providerProcess.adapter.approvalRequestPolicy === "runtime";
  const executionOptions = runtimeOwnsApprovalPolicy
    ? args.getThreadExecutionOptions(resolvedThreadId)
    : undefined;
  const shouldAutoDenyApprovalRequest =
    isApprovalRequest &&
    ((runtimeOwnsApprovalPolicy && executionOptions
      ? shouldAutoDenyInteractiveRequest(executionOptions)
      : false) ||
      !args.onInteractiveRequest);
  if (shouldAutoDenyApprovalRequest) {
    try {
      const resolution = buildDeniedInteractiveResolution(interactiveReq.payload);
      const result = buildInteractiveResponse({
        request: resolvedInteractiveReq,
        resolution,
      });
      sendJsonRpcResult({
        child: args.providerProcess.child,
        id: args.parsedId,
        result,
      });
    } catch (error) {
      if (
        sendProviderResponseEncodeErrorIfKnown({
          child: args.providerProcess.child,
          error,
          id: args.parsedId,
        })
      ) {
        return true;
      }
      sendJsonRpcError({
        child: args.providerProcess.child,
        id: args.parsedId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (!args.onInteractiveRequest) {
    sendJsonRpcError({
      child: args.providerProcess.child,
      id: args.parsedId,
      message: "No interactive request handler is configured for user-question interactions",
    });
    return true;
  }

  const onInteractiveRequest = args.onInteractiveRequest;
  void (async () => {
    try {
      const resolution = await onInteractiveRequest(scopedInteractiveReq);
      const result = buildInteractiveResponse({
        request: resolvedInteractiveReq,
        resolution,
      });
      sendJsonRpcResult({
        child: args.providerProcess.child,
        id: args.parsedId,
        result,
      });
    } catch (err) {
      if (
        sendProviderResponseEncodeErrorIfKnown({
          child: args.providerProcess.child,
          error: err,
          id: args.parsedId,
        })
      ) {
        return;
      }
      sendJsonRpcError({
        child: args.providerProcess.child,
        id: args.parsedId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  return true;
}

export function handleRuntimeProviderRequest(args: HandleRuntimeProviderRequestArgs): void {
  if (handleInteractiveProviderRequest(args)) {
    return;
  }

  sendJsonRpcError({
    child: args.providerProcess.child,
    id: args.parsedId,
    message: `Unsupported provider request "${args.parsedMethod}"`,
    code: -32601,
  });
}
