import Negotiator from "negotiator";

// every negotiated response carries it, or a cache hands the markdown to a browser (or the HTML
// to an agent) depending on which variant primed it first
export const VARY = "Accept, Accept-Encoding";

// the page leads, so a client that ranks both alike, as `*/*` does, keeps the HTML
const REPRESENTATIONS = ["text/html", "text/markdown"];

export const prefersMarkdown = (accept: string | null): boolean =>
  accept !== null &&
  new Negotiator({ headers: { accept } }).mediaType(REPRESENTATIONS) === "text/markdown";

export const markdownResponse = (body: string, init: ResponseInit = {}): Response => {
  // the caller's headers over these, in whichever of HeadersInit's shapes they came
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
