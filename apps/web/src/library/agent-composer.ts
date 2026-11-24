import { quotePassage } from "./quote-passage";

type ComposerTarget =
  | { readonly kind: "asking"; readonly threadId: string | null }
  | { readonly kind: "tidying" };

export interface ComposerState {
  readonly text: string;
  readonly target: ComposerTarget;
  readonly quoted: number;
}

export type ComposerEvent =
  | { readonly kind: "typed"; readonly text: string }
  | { readonly kind: "chose"; readonly threadId: string | null }
  | { readonly kind: "tidy" }
  | { readonly kind: "tidyEnded" }
  | { readonly kind: "asked"; readonly passage: string }
  | { readonly kind: "sent"; readonly threadId: string };

const NEW_CONVERSATION: ComposerTarget = { kind: "asking", threadId: null };

export const COMPOSER_START: ComposerState = { quoted: 0, target: NEW_CONVERSATION, text: "" };

export const composerAfter = (state: ComposerState, event: ComposerEvent) => {
  const { target } = state;

  switch (event.kind) {
    case "typed": {
      return { ...state, quoted: 0, text: event.text } satisfies ComposerState;
    }

    case "tidy": {
      return (
        target.kind === "tidying" ? state : { ...state, target: { kind: "tidying" } }
      ) satisfies ComposerState;
    }

    case "chose": {
      const kept =
        target.kind === "tidying" ? event.threadId === null : target.threadId === event.threadId;

      return (
        kept ? state : { ...state, target: { kind: "asking", threadId: event.threadId } }
      ) satisfies ComposerState;
    }

    case "tidyEnded": {
      return (
        target.kind === "tidying" ? { ...state, target: NEW_CONVERSATION } : state
      ) satisfies ComposerState;
    }

    case "asked": {
      return {
        quoted: state.quoted + 1,
        target: target.kind === "asking" ? target : NEW_CONVERSATION,
        text: quotePassage(state.text, event.passage),
      } satisfies ComposerState;
    }

    case "sent": {
      return {
        quoted: 0,
        target: { kind: "asking", threadId: event.threadId },
        text: "",
      } satisfies ComposerState;
    }

    default: {
      throw new Error(`unexpected ${String(event satisfies never)}`);
    }
  }
};
