import { createFileRoute } from "@tanstack/react-router";
import { getBot } from "@/server/chat/bot";
import { getCloudflareEnv } from "@/lib/cloudflare";

// Discord delivers regular messages over a persistent Gateway WebSocket, which
// serverless platforms can't hold open continuously. The Chat SDK's
// `startGatewayListener` maintains the connection for the lifetime of one
// invocation, so this route is meant to be hit by a scheduler (cron) and kept
// alive for the invocation window.
//
// NOTE: Cloudflare Workers cap wall-clock time and can't keep a long-lived
// socket the way a Node/Vercel function or a Durable Object can. For reliable
// Discord *message* support, run this listener in a long-running process or a
// Durable Object instead. Slack/Telegram/WhatsApp need none of this — they're
// plain webhooks. See README "Discord" for details.
async function handler({ request }: { request: Request }) {
  const env = getCloudflareEnv();
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const webhookUrl = `https://${new URL(request.url).host}/api/webhooks/discord`;

  const discord = getBot().getAdapter("discord") as unknown as {
    startGatewayListener?: (webhookUrl: string) => Promise<Response> | Response;
  };
  if (typeof discord.startGatewayListener !== "function") {
    return new Response("Discord gateway listener unavailable", { status: 501 });
  }
  return discord.startGatewayListener(webhookUrl);
}

export const Route = createFileRoute("/api/discord/gateway")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
