import { markdownResponse } from "#lib/content-negotiation";
import { notFoundMarkdown, pageMarkdown } from "#lib/site-content";

// proxy.ts rewrites a page asked for as markdown here; nothing links it, and it is no public
// address. A path no page serves is a 404 an agent can recover from.
export const GET = async (
  _request: Request,
  { params }: RouteContext<"/api/markdown/[[...slug]]">,
) => {
  const { slug = [] } = await params;
  const path = `/${slug.join("/")}`;
  const markdown = pageMarkdown(path);
  return markdown === undefined
    ? markdownResponse(notFoundMarkdown(path), {
        headers: { "Cache-Control": "no-store" },
        status: 404,
      })
    : markdownResponse(markdown);
};
