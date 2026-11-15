// One cut for every short excerpt an item's row keeps (a card's preview, a link's line): the text
// as it is when it fits, else its first `max - 1` units and an ellipsis.

export const clipSnippet = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
