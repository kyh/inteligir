// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed adapter contract: the commands and members the codex adapter
// implements. Dropped commands (skills/configure, model-listing-adjacent
// fork/discard/goal/rename/archive), dynamic-tool decoding, capability-based
// plan fallbacks and the bridge factory options are recorded in PROVENANCE.md.

import type {
  InstructionMode,
  RuntimePermissionPolicy,
  RuntimeThreadExecutionOptions,
} from "./vocabulary/shared-types.js";
import type { AvailableModel, ProviderCapabilities } from "./vocabulary/provider-types.js";
import type {
  PendingInteractionPayload,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { ProviderEvent, ProviderEventUserContent } from "./vocabulary/provider-event.js";
import type { ProviderInboundRequest, ProviderRuntimeEvent } from "./runtime-json-rpc.js";
import type { JsonValue } from "./vocabulary/json-value.js";

/** What a turn's prompt is made of; bb's PromptInput, mentions dropped. */
export type PromptInput = ProviderEventUserContent;

export interface ProviderTranslationContext {
  threadId?: string;
}

export interface ProviderRequestCommandPlan {
  kind: "request";
  method: string;
  params?: object;
}

export interface ProviderNoopCommandPlan {
  kind: "noop";
  method?: never;
  params?: never;
  reason: string;
}

export type ProviderCommandPlan = ProviderRequestCommandPlan | ProviderNoopCommandPlan;

export interface ProviderPostInitializeRequest {
  plan: ProviderRequestCommandPlan;
  required: boolean;
  onResult(result: JsonValue): void;
}

export type ProviderInteractiveResponse =
  | boolean
  | number
  | string
  | null
  | ProviderInteractiveResponse[]
  | { [key: string]: ProviderInteractiveResponse | undefined };

export interface DecodedInteractiveRequest {
  requestId: string | number;
  method: string;
  providerThreadId: string;
  /**
   * Non-empty host turn id when known. Null is the canonical unresolved
   * value so the runtime can resolve from the active turn; empty strings are
   * malformed adapter output.
   */
  turnId: string | null;
  payload: PendingInteractionPayload;
  threadId?: string;
}

// Intersecting with the policy union (not Pick-ing its members) is what
// keeps the discriminant correlation: a `workspace` scope still implies a
// non-null escalation inside each branch.
export type ProviderExecutionContext = {
  model?: string;
  reasoningLevel?: RuntimeThreadExecutionOptions["reasoningLevel"];
  instructions?: string;
  envVars?: Record<string, string>;
} & RuntimePermissionPolicy;

export type AdapterCommand =
  | { type: "initialize" }
  | { type: "model/list" }
  | {
      type: "thread/start";
      threadId: string;
      cwd: string;
      options: ProviderExecutionContext;
      instructionMode: InstructionMode;
    }
  | {
      type: "thread/resume";
      threadId: string;
      cwd: string;
      providerThreadId: string;
      options: ProviderExecutionContext;
      instructionMode: InstructionMode;
    }
  | {
      type: "turn/start";
      threadId: string;
      providerThreadId: string;
      input: PromptInput[];
      options: ProviderExecutionContext;
    }
  | {
      type: "turn/steer";
      threadId: string;
      providerThreadId: string;
      expectedTurnId: string;
      input: PromptInput[];
      options: ProviderExecutionContext;
    }
  | {
      type: "thread/stop";
      threadId: string;
      providerThreadId: string;
      /**
       * Non-null means the stop interrupts an active provider turn. Null
       * means an idle stop, which needs no provider request at all.
       */
      activeTurnId: string | null;
    };

export type ProviderExecutionSettingsChange = "unchanged" | "live" | "session";

export interface ClassifyProviderExecutionSettingsChangeArgs {
  current: RuntimeThreadExecutionOptions;
  next: RuntimeThreadExecutionOptions;
}

export interface ProviderAdapter {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  /**
   * Selects where approval escalation is enforced. `runtime` adapters emit
   * every approval request and rely on the runtime's current thread policy.
   */
  approvalRequestPolicy: "runtime" | "provider";
  process: { command: string; args: string[]; env?: Record<string, string> };

  buildCommandPlan(command: AdapterCommand): ProviderCommandPlan;
  /**
   * Optional provider-specific reads performed after the protocol initialize
   * request and before any thread work starts. Best-effort requests let newer
   * providers hydrate adapter-local state without making older provider
   * versions unusable when they do not implement the read.
   */
  buildPostInitializeRequests?(): readonly ProviderPostInitializeRequest[];
  parseModelListResult(result: JsonValue): { models: AvailableModel[] };
  translateEvent(
    event: ProviderRuntimeEvent,
    context?: ProviderTranslationContext,
  ): ProviderEvent[];
  decodeInteractiveRequest?(request: ProviderInboundRequest): DecodedInteractiveRequest | null;
  buildInteractiveResponse?(args: BuildInteractiveResponseArgs): ProviderInteractiveResponse;
}

export interface BuildInteractiveResponseArgs {
  request: DecodedInteractiveRequest;
  resolution: PendingInteractionResolution;
}
