// Who a write is by, and so which change set it joins: the person on one device, a connected
// assistant under one grant, the built-in agent in one turn, one import, or the cloud reading one
// page. `label` is the set's words for them, which the caller supplies, since the cell knows no
// device name or assistant; an undo is a set of its own, by whoever asked.

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
  | { readonly kind: "fill"; readonly label: string };

export type ChangeSetActor = (typeof CHANGE_SET_ACTORS)[number];

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

// When an actor's set closes. A person's typing is one set until 15 s of quiet or a minute in all,
// so one burst of typing is one change set; an assistant's calls under one grant, until 10 idle
// minutes; a turn or an import is closed by what runs it; a fill or an undo is a set of one write.
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
  undo: { kind: "commit" },
} as const satisfies Record<ChangeSetActor, SealPolicy>;
