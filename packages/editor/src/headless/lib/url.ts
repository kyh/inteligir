const PDF_PATH_RE = /\.pdf(?:[?#]|$)/iu;

export const isPdfUrl = (url: string) => PDF_PATH_RE.test(url);
