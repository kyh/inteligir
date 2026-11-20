export const plainText = (status: number, text: string) =>
  new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status,
  });
