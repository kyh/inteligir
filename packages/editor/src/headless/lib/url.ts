const PDF_PATH_RE = /\.pdf(?:[?#]|$)/iu;

export const isPdfUrl = (url: string): boolean => PDF_PATH_RE.test(url);
