// Who a write is by: the person, a connected assistant, an import, the cloud reading a page, or the
// built-in agent in one turn of one thread, the one writer whose writes a change set keeps, since
// Undo reaches only the agent's turns.

export interface TurnActor {
  readonly kind: "agent";
  readonly threadId: string;
  readonly turn: number;
}

export type CellActor = TurnActor | { readonly kind: "person" | "assistant" | "import" | "fill" };
