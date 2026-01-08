export const encodeURL = (pathname: string, search?: string) => {
  let callbackUrl = pathname;

  if (search) {
    const normalizedSearch = search.startsWith('?') ? search : `?${search}`;
    callbackUrl += normalizedSearch;
  }

  return encodeURIComponent(callbackUrl);
};
