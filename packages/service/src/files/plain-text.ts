export const plainText = (
  status: number,
  text: string,
  headers: Readonly<Record<string, string>> = {},
) =>
  new Response(text, {
    headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
    status,
  });
