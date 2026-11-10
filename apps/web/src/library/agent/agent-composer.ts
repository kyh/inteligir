// What the agent's composer holds beside the person's typing, which the workspace keeps, since the
// grid's header, ⌘P and the editor each move it: the conversation a message goes to and a passage
// the editor asked about until the field quotes it, or Tidy my library's request, which starts a
// conversation of its own.

export type ComposerState =
  | { readonly kind: "asking"; readonly threadId: string | null; readonly passage: string | null }
  | { readonly kind: "tidying" };

export type ComposerEvent =
  // a conversation, or none for a new one, chosen in the panel or by a send's answer
  | { readonly kind: "chose"; readonly threadId: string | null }
  | { readonly kind: "tidy" }
  // the Tidy's request sent or dropped
  | { readonly kind: "tidyEnded" }
  | { readonly kind: "asked"; readonly passage: string }
  | { readonly kind: "quoted" };

export const COMPOSER_START: ComposerState = { kind: "asking", passage: null, threadId: null };

// the composer `event` leaves; one it cannot take leaves the same state, so React renders nothing
export const composerAfter = (state: ComposerState, event: ComposerEvent): ComposerState => {
  switch (event.kind) {
    case "tidy": {
      return state.kind === "tidying" ? state : { kind: "tidying" };
    }
    case "chose": {
      if (state.kind === "tidying") {
        // a new conversation keeps the Tidy waiting; one already there lets it go
        return event.threadId === null
          ? state
          : { kind: "asking", passage: null, threadId: event.threadId };
      }
      return state.threadId === event.threadId ? state : { ...state, threadId: event.threadId };
    }
    case "tidyEnded": {
      return state.kind === "tidying" ? COMPOSER_START : state;
    }
    case "asked": {
      return {
        kind: "asking",
        passage: event.passage,
        threadId: state.kind === "asking" ? state.threadId : null,
      };
    }
    case "quoted": {
      return state.kind === "asking" && state.passage !== null
        ? { ...state, passage: null }
        : state;
    }
    // no default
  }
};
