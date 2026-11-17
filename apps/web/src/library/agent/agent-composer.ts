// What the agent's composer holds, kept by the tab's store (`../workspace-store.ts`), since the
// grid's header, ⌘P and the editor each move it and the Agent tab that draws it comes and goes: the
// words typed, and where they go, a conversation or Tidy my library's request, which starts a
// conversation of its own.

import { quotePassage } from "./quote-passage";

type ComposerTarget =
  | { readonly kind: "asking"; readonly threadId: string | null }
  | { readonly kind: "tidying" };

export interface ComposerState {
  readonly text: string;
  readonly target: ComposerTarget;
  // the passages quoted since the person last typed, while which the field takes the keyboard
  readonly quoted: number;
}

export type ComposerEvent =
  | { readonly kind: "typed"; readonly text: string }
  // a conversation, or none for a new one, chosen in the panel
  | { readonly kind: "chose"; readonly threadId: string | null }
  | { readonly kind: "tidy" }
  // the Tidy's request dropped
  | { readonly kind: "tidyEnded" }
  // a passage the editor asked about, quoted under what the field holds
  | { readonly kind: "asked"; readonly passage: string }
  // a message sent, which the cell answered with the conversation it went to
  | { readonly kind: "sent"; readonly threadId: string };

const NEW_CONVERSATION: ComposerTarget = { kind: "asking", threadId: null };

export const COMPOSER_START: ComposerState = { quoted: 0, target: NEW_CONVERSATION, text: "" };

// the composer `event` leaves; one it cannot take leaves the same state, so nothing renders
export const composerAfter = (state: ComposerState, event: ComposerEvent): ComposerState => {
  const { target } = state;
  switch (event.kind) {
    case "typed": {
      return { ...state, quoted: 0, text: event.text };
    }
    case "tidy": {
      return target.kind === "tidying" ? state : { ...state, target: { kind: "tidying" } };
    }
    case "chose": {
      // a new conversation keeps a Tidy waiting; one already there lets it go
      const kept =
        target.kind === "tidying" ? event.threadId === null : target.threadId === event.threadId;
      return kept ? state : { ...state, target: { kind: "asking", threadId: event.threadId } };
    }
    case "tidyEnded": {
      return target.kind === "tidying" ? { ...state, target: NEW_CONVERSATION } : state;
    }
    case "asked": {
      return {
        quoted: state.quoted + 1,
        target: target.kind === "asking" ? target : NEW_CONVERSATION,
        text: quotePassage(state.text, event.passage),
      };
    }
    case "sent": {
      return { quoted: 0, target: { kind: "asking", threadId: event.threadId }, text: "" };
    }
    // no default
  }
};
