// Whether a WebView's request names the document it was handed. A fragment never names another
// document, and WebKit may hand back, escaped, a uri it was given raw (a space as %20), or raw one
// it was given escaped, so both sides are compared bare and decoded; an escape that does not decode
// is compared as written. The editor's page and the viewer's held file each load by it.

const documentOf = (url: string): string => {
  const hash = url.indexOf("#");
  const bare = hash === -1 ? url : url.slice(0, hash);
  try {
    return decodeURI(bare);
  } catch {
    return bare;
  }
};

export const sameDocument = (url: string, documentUrl: string): boolean =>
  documentOf(url) === documentOf(documentUrl);
