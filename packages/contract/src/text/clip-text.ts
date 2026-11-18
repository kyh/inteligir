export const clipSnippet = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
