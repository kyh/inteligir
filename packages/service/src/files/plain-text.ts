// An answer outside the wire's protocol, to a request no client's link reads: a file's read or an
// upload refused, in a sentence.

export const plainText = (
  status: number,
  text: string,
  headers: Readonly<Record<string, string>> = {},
): Response =>
  new Response(text, {
    headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
    status,
  });
