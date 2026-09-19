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
  "client/turn/requested": {
    policy: "thread",
    rationale:
      "Outbound client lifecycle event; it records the request before provider turn acceptance, so no turn id exists yet.",
  },
  "item/agentMessage/delta": { policy: "turn" },
  "item/commandExecution/outputDelta": { policy: "turn" },
  "item/completed": { policy: "turn" },
  "item/plan/delta": { policy: "turn" },
  "item/reasoning/summaryTextDelta": { policy: "turn" },
  "item/reasoning/textDelta": { policy: "turn" },
  "item/started": { policy: "turn" },
  "provider/error": {
    policy: "thread-or-turn",
    rationale:
      "Provider diagnostics use thread scope for provider setup/session failures; in-turn failures use turn scope.",
  },
  "thread/tokenUsage/updated": { policy: "turn" },
  "turn/completed": { policy: "turn" },
  "turn/started": { policy: "turn" },
} as const satisfies Record<ThreadEventType, ThreadEventScopePolicyDefinition>;

export interface ValidateThreadEventScopeArgs {
  scope: ThreadEventScope;
  type: ThreadEventType;
}

export interface ValidateThreadEventScopeResult {
  message?: string;
  valid: boolean;
}

export const threadScope = (): ThreadEventScope => ({ kind: "thread" });

export const turnScope = (turnId: string): ThreadEventScope => ({ kind: "turn", turnId });

export const getThreadEventScopeTurnId = (scope: ThreadEventScope): string | undefined =>
  scope.kind === "turn" ? scope.turnId : undefined;

export interface RequireThreadEventScopeTurnIdArgs {
  scope: ThreadEventScope;
  // error message only; callers pass their own event vocabulary.
  type: string;
}

export const requireThreadEventScopeTurnId = (args: RequireThreadEventScopeTurnIdArgs): string => {
  if (args.scope.kind !== "turn") {
    throw new Error(`${args.type} requires turn scope but received ${args.scope.kind} scope`);
  }
  return args.scope.turnId;
};

export const validateThreadEventScope = (
  args: ValidateThreadEventScopeArgs,
): ValidateThreadEventScopeResult => {
  const { policy } = threadEventScopeDefinitionByType[args.type];

  if (policy === "thread-or-turn") {
    return { valid: true };
  }

  if (policy !== args.scope.kind) {
    return {
      message: `${args.type} requires ${policy} scope but received ${args.scope.kind} scope`,
      valid: false,
    };
  }

  return { valid: true };
};
