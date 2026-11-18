const documentOf = (url: string) => {
  const hash = url.indexOf("#");
  const bare = hash === -1 ? url : url.slice(0, hash);

  try {
    return decodeURI(bare);
  } catch {
    return bare;
  }
};

export const sameDocument = (url: string, documentUrl: string) =>
  documentOf(url) === documentOf(documentUrl);
