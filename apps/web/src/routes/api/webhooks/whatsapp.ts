import { createFileRoute } from "@tanstack/react-router";
import { getBot } from "@/server/chat/bot";

// WhatsApp uses GET for the verification handshake (hub.challenge) and POST for
// event delivery — the adapter handles both behind the same entry point.
function handler({ request }: { request: Request }) {
  return getBot().webhooks.whatsapp(request);
}

export const Route = createFileRoute("/api/webhooks/whatsapp")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
