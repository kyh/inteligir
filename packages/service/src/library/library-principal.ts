import type { AppPrincipal } from "../rpc/admit";

export interface TurnActor {
  readonly kind: "agent";
  readonly threadId: string;
  readonly turn: number;
}

export type LibraryActor =
  | TurnActor
  | { readonly kind: "person" | "assistant" | "import" | "fill" };

export type LibraryScope = "library" | "library:read";

export interface ConnectorPrincipal {
  readonly accountId: string;
  readonly actor: {
    readonly kind: "assistant";
    readonly clientId: string;
    readonly clientName: string;
    readonly grantId: string;
    readonly scopes: readonly LibraryScope[];
  };
}

interface AgentPrincipal {
  readonly accountId: string;
  readonly actor: TurnActor;
}

export type LibraryPrincipal = AppPrincipal | ConnectorPrincipal | AgentPrincipal;

export const libraryActorOf = ({ actor }: LibraryPrincipal) => {
  switch (actor.kind) {
    case "session": {
      return { kind: "person" } satisfies LibraryActor;
    }

    case "assistant": {
      return { kind: "assistant" } satisfies LibraryActor;
    }

    case "agent": {
      return actor;
    }

    default: {
      throw new Error(`unexpected ${String(actor satisfies never)}`);
    }
  }
};

export const changesLibrary = ({ actor }: LibraryPrincipal) =>
  actor.kind !== "assistant" || actor.scopes.includes("library");
