// how the server names a thread from its first message: that message's first visible line.

const THREAD_TITLE_MAX_CHARS = 60;

// an explicit title's bound: the create route takes no longer one, and the log carries what it took.
export const MAX_THREAD_TITLE_LENGTH = 200;

// null when the text has no visible line: an untitled thread reads better than a blank one.
export const firstVisibleLine = (text: string): string | null => {
  const line = text
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== "");
  if (line === undefined) {
    return null;
  }
  // by code point, so a cut never splits a surrogate pair into a replacement character.
  const chars = [...line];
  return chars.length > THREAD_TITLE_MAX_CHARS
    ? `${chars.slice(0, THREAD_TITLE_MAX_CHARS - 1).join("")}…`
    : line;
};

export const deriveThreadTitle = (message: string): string | null => firstVisibleLine(message);
