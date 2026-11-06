import { createFileRoute, notFound } from "@tanstack/react-router";

import { markdownResponse, prefersMarkdown } from "@/lib/content-negotiation";
import { varyHeaders } from "@/lib/markdown-route";
import { notFoundMarkdown } from "@/lib/site-content";

// the 404 status was already there; this route gives an agent that asks for markdown a body it
// can recover from instead of Start's JSON refusal
export const Route = createFileRoute("/$")({
  // never rendered (the loader throws first), but without a component Start treats the handler
  // as terminal and next() throws instead of falling through to the SSR 404
  component: () => null,
  loader: () => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's notFound() is thrown as it returns it (tanstack.com/router/latest/docs/framework/react/guide/not-found-errors)
    throw notFound();
  },
  headers: varyHeaders,
  server: {
    handlers: {
      GET: ({ request, next }) =>
        prefersMarkdown(request.headers.get("accept"))
          ? markdownResponse(notFoundMarkdown(new URL(request.url).pathname), {
              headers: { "Cache-Control": "no-store" },
              status: 404,
            })
          : next(),
    },
  },
});
