export const oauthQueryOf = (search: Record<string, string | string[] | undefined>) => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    for (const each of [value ?? []].flat()) {
      params.append(key, each);
    }
  }

  return params.has("sig") ? params.toString() : null;
};
