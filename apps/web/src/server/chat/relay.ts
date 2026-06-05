import { PARTY_NAME, type ChatConversation } from "@repo/dispatch";
import { getCloudflareEnv } from "@/lib/cloudflare";

/**
 * Relay one inbound chat message to the desktop agent and wait for its reply.
 *
 * The desktop sits behind NAT, so we can't reach it directly. Instead we POST
 * into the party room it holds a WebSocket to; the room forwards the message,
 * blocks on the matching `chat_reply`, and returns the agent's text here. The
 * gateway then posts that text back to the platform through the live thread.
 *
 * Returns `null` when the relay isn't configured, the desktop is offline, or
 * the turn times out — callers surface a friendly fallback to the user.
 */
export async function relayToDesktop(input: {
  text: string;
  conversation?: ChatConversation;
}): Promise<string | null> {
  const env = getCloudflareEnv();
  const host = env.CHAT_RELAY_PARTY_HOST;
  const room = env.CHAT_RELAY_ROOM;

  if (!host || !room) {
    console.error("[chat] CHAT_RELAY_PARTY_HOST / CHAT_RELAY_ROOM not configured");
    return null;
  }

  const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  const url = `${proto}://${host}/parties/${PARTY_NAME}/${room}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-secret": env.CHAT_RELAY_SECRET ?? "",
      },
      body: JSON.stringify({ text: input.text, conversation: input.conversation }),
    });
    if (!res.ok) {
      console.error(`[chat] relay failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { text?: string };
    return data.text ?? null;
  } catch (err) {
    console.error("[chat] relay error:", err);
    return null;
  }
}
