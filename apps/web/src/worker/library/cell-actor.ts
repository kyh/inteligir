// Who a write is by, and so which change set it joins: the person on one device, a connected
// assistant under one grant, the built-in agent in one turn, one import, the cloud reading one
// page, or the library itself. `label` is History's words for them, which the caller supplies,
// since the cell knows no device name or assistant; an undo is a set of its own, by whoever asked.

import type { AnnotationSource } from "@repo/notes/annotations/store-schema";
import type { CHANGE_SET_ACTORS } from "@repo/notes/library/library-schema";

export type CellActor =
  | { readonly kind: "person"; readonly deviceId: string; readonly label: string }
  | {
      readonly kind: "assistant";
      readonly grantId: string;
      readonly clientId: string;
      readonly label: string;
    }
  | {
      readonly kind: "agent";
      readonly threadId: string;
      readonly turn: number;
      readonly label: string;
    }
  | { readonly kind: "import"; readonly jobId: string; readonly label: string }
  | { readonly kind: "fill"; readonly label: string }
  | { readonly kind: "system"; readonly label: string };

export type ChangeSetActor = (typeof CHANGE_SET_ACTORS)[number];

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

// When an actor's set closes. A person's typing is one set until 15 s of quiet or a minute in all,
// the rhythm the Mac's auto-commit kept; an assistant's calls under one grant, until 10 idle
// minutes; a turn or an import is closed by what runs it; a fill or the library's own write is a
// set of one write.
export type SealPolicy =
  | { readonly kind: "quiet"; readonly quietMs: number; readonly capMs: number | null }
  | { readonly kind: "explicit" }
  | { readonly kind: "commit" };

export const SEAL_POLICIES = {
  agent: { kind: "explicit" },
  assistant: { capMs: null, kind: "quiet", quietMs: 10 * MINUTE_MS },
  fill: { kind: "commit" },
  import: { kind: "explicit" },
  person: { capMs: MINUTE_MS, kind: "quiet", quietMs: 15 * SECOND_MS },
  system: { kind: "commit" },
  undo: { kind: "commit" },
} as const satisfies Record<ChangeSetActor, SealPolicy>;

// who a highlight is by, as its row keeps it: an agent's, whoever's agent it is, and an import's
// or a page's as the outside writer's
export const annotationSourceOf = (actor: CellActor): AnnotationSource => {
  switch (actor.kind) {
    case "person": {
      return "user";
    }
    case "assistant":
    case "agent": {
      return "agent";
    }
    case "import":
    case "fill":
    case "system": {
      return "external";
    }
    // no default
  }
};
