// a link a page names, as an absolute web address against the page's own: http and https alone,
// never an in-page anchor or inline data. A page's links are hostile input, so a link that does not
// resolve is no link.

export const resolveWebUrl = (raw: string, base: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.startsWith("#") || /^data:/iu.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};
