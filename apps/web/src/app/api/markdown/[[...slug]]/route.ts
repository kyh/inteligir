import { markdownResponse } from "#lib/content-negotiation";
import { notFoundMarkdown, pageMarkdown } from "#lib/site-content";

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
