import Negotiator from "negotiator";

const VARY = "Accept, Accept-Encoding";

const REPRESENTATIONS = ["text/html", "text/markdown"];

export const prefersMarkdown = (accept: string | null) =>
  accept !== null &&
  new Negotiator({ headers: { accept } }).mediaType(REPRESENTATIONS) === "text/markdown";

export const markdownResponse = (body: string, init: ResponseInit = {}) => {
  const headers = new Headers({
    "Cache-Control": "public, max-age=300",
    "Content-Type": "text/markdown; charset=utf-8",
    Vary: VARY,
  });

  for (const [name, value] of new Headers(init.headers)) {
    headers.set(name, value);
  }

  return new Response(body, { status: 200, ...init, headers });
};
