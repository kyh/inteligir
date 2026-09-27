import { markdownResponse, prefersMarkdown, VARY } from "@/lib/content-negotiation";

/** A page's server GET: its markdown when the client asks for it, otherwise the SSR HTML. */
export const markdownHandler =
  (markdown: string) =>
  <TNext>({ request, next }: { request: Request; next: () => TNext }) =>
    prefersMarkdown(request.headers.get("accept")) ? markdownResponse(markdown) : next();

// the HTML variant's half of the negotiation; a route's headers() is how Start decorates the
// response it renders downstream of the handler
export const varyHeaders = () => ({ Vary: VARY });
