// What every host says of the open item, in the same words, when a merge kept this device's lines
// over another's; an item may have no title yet.
export const mergeConflictLine = (title: string): string =>
  `${title === "" ? "This item" : title} also changed elsewhere. Where both changed the same lines, yours were kept.`;
