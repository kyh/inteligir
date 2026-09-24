export const isHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

// a note is untrusted: only an http(s) url reaches a new window, never a `javascript:` or `file:`
// one, and noopener keeps this window out of the opened page's reach.
export const openExternalUrl = (url: string): void => {
  if (isHttpUrl(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};
