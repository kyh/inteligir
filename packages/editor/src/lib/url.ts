export const isHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const PDF_PATH_RE = /\.pdf(?:[?#]|$)/iu;

export const isPdfUrl = (url: string): boolean => PDF_PATH_RE.test(url);
