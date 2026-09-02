// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";
import type { ThreadEventType } from "./provider-event";

export const threadEventScopeKindValues = ["thread", "turn"] as const;
export const threadEventScopeKindSchema = z.enum(threadEventScopeKindValues);
export type ThreadEventScopeKind = z.infer<typeof threadEventScopeKindSchema>;

export const threadEventScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread") }),
  z.object({ kind: z.literal("turn"), turnId: z.string().min(1) }),
]);
export type ThreadEventScope = z.infer<typeof threadEventScopeSchema>;

export type ThreadEventScopePolicy = "thread" | "turn" | "thread-or-turn";

interface TurnOnlyThreadEventScopePolicyDefinition {
  policy: "turn";
}

// anything looser than turn scope states why.
interface ThreadScopedThreadEventScopePolicyDefinition {
  policy: "thread" | "thread-or-turn";
  rationale: string;
}

type ThreadEventScopePolicyDefinition =
  | TurnOnlyThreadEventScopePolicyDefinition
  | ThreadScopedThreadEventScopePolicyDefinition;

// `satisfies` keeps the table total: an event type without a row stops compiling.
export const threadEventScopeDefinitionByType = {
  "turn/started": { policy: "turn" },
  "turn/completed": { policy: "turn" },
  "item/started": { policy: "turn" },
  "item/completed": { policy: "turn" },
  "item/agentMessage/delta": { policy: "turn" },
  "item/commandExecution/outputDelta": { policy: "turn" },
  "item/reasoning/summaryTextDelta": { policy: "turn" },
  "item/reasoning/textDelta": { policy: "turn" },
  "item/plan/delta": { policy: "turn" },
  "thread/tokenUsage/updated": { policy: "turn" },
  "provider/error": {
    policy: "thread-or-turn",
    rationale:
      "Provider diagnostics use thread scope for provider setup/session failures; in-turn failures use turn scope.",
  },
  "client/turn/requested": {
    policy: "thread",
    rationale:
      "Outbound client lifecycle event; it records the request before provider turn acceptance, so no turn id exists yet.",
  },
} as const satisfies Record<ThreadEventType, ThreadEventScopePolicyDefinition>;

export interface ValidateThreadEventScopeArgs {
  scope: ThreadEventScope;
  type: ThreadEventType;
}

export interface ValidateThreadEventScopeResult {
  message?: string;
  valid: boolean;
}

export function threadScope(): ThreadEventScope {
  return { kind: "thread" };
}

export function turnScope(turnId: string): ThreadEventScope {
  return { kind: "turn", turnId };
}

export function getThreadEventScopeTurnId(scope: ThreadEventScope): string | undefined {
  return scope.kind === "turn" ? scope.turnId : undefined;
}

export interface RequireThreadEventScopeTurnIdArgs {
  scope: ThreadEventScope;
  // error message only; callers pass their own event vocabulary.
  type: string;
}

export function requireThreadEventScopeTurnId(args: RequireThreadEventScopeTurnIdArgs): string {
  if (args.scope.kind !== "turn") {
    throw new Error(`${args.type} requires turn scope but received ${args.scope.kind} scope`);
  }
  return args.scope.turnId;
}

export function validateThreadEventScope(
  args: ValidateThreadEventScopeArgs,
): ValidateThreadEventScopeResult {
  const policy = threadEventScopeDefinitionByType[args.type].policy;

  if (policy === "thread-or-turn") {
    return { valid: true };
  }

  if (policy !== args.scope.kind) {
    return {
      valid: false,
      message: `${args.type} requires ${policy} scope but received ${args.scope.kind} scope`,
    };
  }

  return { valid: true };
}
