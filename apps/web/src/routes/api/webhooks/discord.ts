import { createFileRoute } from "@tanstack/react-router";
import { getBot } from "@/server/chat/bot";

// Discord's Interactions endpoint: handles the PING verification and slash
// commands. Regular channel/DM *messages* arrive over the Gateway WebSocket,
// not here — see ./api/discord/gateway for the listener route and the README
// for the Cloudflare caveat (Workers can't hold a persistent Gateway socket).
function handler({ request }: { request: Request }) {
  return getBot().webhooks.discord(request);
}

export const Route = createFileRoute("/api/webhooks/discord")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
