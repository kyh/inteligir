// ---------------------------------------------------------------------------
// LiveKit token generation for room access
// ---------------------------------------------------------------------------

import { AccessToken } from "livekit-server-sdk";

export type LiveKitCredentials = {
  url: string;
  token: string;
};

const TOKEN_TTL = "6h";
const TOKEN_REFRESH_THRESHOLD_MS = 10 * 60 * 1_000; // refresh if <10 min remaining

let cachedCredentials: { credentials: LiveKitCredentials; expiresAt: number } | null = null;

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

  // Return cached token if still valid with comfortable margin
  if (cachedCredentials && Date.now() < cachedCredentials.expiresAt - TOKEN_REFRESH_THRESHOLD_MS) {
    return cachedCredentials.credentials;
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: TOKEN_TTL,
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
  const credentials = { url, token: jwt };

  // Parse TTL to ms for cache expiry (format: "6h")
  const ttlHours = parseInt(TOKEN_TTL, 10);
  cachedCredentials = {
    credentials,
    expiresAt: Date.now() + ttlHours * 60 * 60 * 1_000,
  };

  return credentials;
}
