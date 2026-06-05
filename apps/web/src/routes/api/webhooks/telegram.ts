import { createFileRoute } from "@tanstack/react-router";
import { getBot } from "@/server/chat/bot";

function handler({ request }: { request: Request }) {
  return getBot().webhooks.telegram(request);
}

export const Route = createFileRoute("/api/webhooks/telegram")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
