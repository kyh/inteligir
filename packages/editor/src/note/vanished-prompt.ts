// What every host says about the open item in the same words: the line a save that kept this
// device's lines over another's says.

export const mergeConflictLine = (path: string): string =>
  `${path} also changed elsewhere. Where both changed the same lines, yours were kept.`;
