// The Worker's answers outside the one wire: a file's or an export's bytes, and a socket's
// upgrade, each spelled in HTTP's own statuses with a sentence a person can read, since no client
// parses a body there.

export const plainText = (status: number, message: string, headers: HeadersInit = {}): Response =>
  new Response(message, {
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
    status,
  });

// NaN when undeclared, never 0: Number("") is 0, so an absent header would read as a tiny body
export const declaredLength = (headers: Headers): number => {
  const header = headers.get("content-length") ?? "";
  return /^\d+$/u.test(header) ? Number(header) : Number.NaN;
};
