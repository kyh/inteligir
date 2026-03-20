// ---------------------------------------------------------------------------
// LiveKit token generation for room access
// ---------------------------------------------------------------------------

import { AccessToken } from "livekit-server-sdk";

export type LiveKitCredentials = {
  url: string;
  token: string;
};

/**
 * Mint a JWT for a participant to join a LiveKit room.
 * Reads LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET from env.
 */
export async function createRoomToken(
  roomName: string,
  identity: string,
  options?: { canPublish?: boolean; canSubscribe?: boolean; canPublishData?: boolean },
): Promise<LiveKitCredentials> {
  const url = process.env["LIVEKIT_URL"];
  const apiKey = process.env["LIVEKIT_API_KEY"];
  const apiSecret = process.env["LIVEKIT_API_SECRET"];

  if (!url) throw new Error("LIVEKIT_URL env var is required");
  if (!apiKey) throw new Error("LIVEKIT_API_KEY env var is required");
  if (!apiSecret) throw new Error("LIVEKIT_API_SECRET env var is required");

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: "1h",
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate: true,
    canPublish: options?.canPublish ?? true,
    canSubscribe: options?.canSubscribe ?? true,
    canPublishData: options?.canPublishData ?? true,
  });

  const jwt = await token.toJwt();
  return { url, token: jwt };
}
