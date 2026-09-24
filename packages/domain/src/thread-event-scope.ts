// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

export const threadScopeSchema = z.object({ kind: z.literal("thread") });
type ThreadScope = z.infer<typeof threadScopeSchema>;

export const turnScopeSchema = z.object({ kind: z.literal("turn"), turnId: z.string().min(1) });
export type TurnScope = z.infer<typeof turnScopeSchema>;

export const threadEventScopeSchema = z.discriminatedUnion("kind", [
  threadScopeSchema,
  turnScopeSchema,
]);
export type ThreadEventScope = z.infer<typeof threadEventScopeSchema>;
export type ThreadEventScopeKind = ThreadEventScope["kind"];

export const threadScope = (): ThreadScope => ({ kind: "thread" });

export const turnScope = (turnId: string): TurnScope => ({ kind: "turn", turnId });

export const getThreadEventScopeTurnId = (scope: ThreadEventScope): string | undefined =>
  scope.kind === "turn" ? scope.turnId : undefined;
