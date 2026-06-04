import { createFileRoute } from "@tanstack/react-router";
import { getServerContext } from "@/lib/server-context";

function handler({ request }: { request: Request }) {
  const { auth } = getServerContext();
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  // @ts-expect-error -- server.handlers is injected by the TanStack Start vite plugin
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
