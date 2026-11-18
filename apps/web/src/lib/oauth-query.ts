// The request the provider signed, rebuilt from a page's search params: null with no signature.
export const oauthQueryOf = (
  search: Record<string, string | string[] | undefined>,
): string | null => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const each of [value ?? []].flat()) {
      params.append(key, each);
    }
  }
  return params.has("sig") ? params.toString() : null;
};
