// Who a call to the library is by, and the actor its writes are by. A person reaches it through
// one of their sessions on `/v1` (`../rpc/admit`); a connected assistant through one grant of the
// connector's consent page, its scopes what the person let that grant do; and the built-in agent
// in one turn of one thread, the one writer whose writes a change set keeps, since Undo reaches only
// the agent's turns. Nothing a caller sends names a principal: each door resolves its own.

import type { AppPrincipal } from "../rpc/admit";

export interface TurnActor {
  readonly kind: "agent";
  readonly threadId: string;
  readonly turn: number;
}

// beside the person, a connected assistant and the agent: an import a device runs, and the cloud
// reading a saved page
export type LibraryActor =
  | TurnActor
  | { readonly kind: "person" | "assistant" | "import" | "fill" };

// `library` reads and changes the library, and `library:read` reads it alone
type LibraryScope = "library" | "library:read";

interface ConnectorPrincipal {
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

export const libraryActorOf = ({ actor }: LibraryPrincipal): LibraryActor => {
  switch (actor.kind) {
    case "session": {
      return { kind: "person" };
    }
    case "assistant": {
      return { kind: "assistant" };
    }
    case "agent": {
      return actor;
    }
    // no default
  }
};

// whether the principal may change the library, not only read it: only a grant limits it
export const changesLibrary = ({ actor }: LibraryPrincipal): boolean =>
  actor.kind !== "assistant" || actor.scopes.includes("library");
