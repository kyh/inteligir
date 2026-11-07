// One cut for every short excerpt the library shows (a card's preview, a link's line, a search
// hit): the text as it is when it fits, else its first `max - 1` units and an ellipsis.

const SNIPPET_MAX = 200;

export const clipSnippet = (text: string, max: number = SNIPPET_MAX): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
