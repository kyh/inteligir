// ---------------------------------------------------------------------------
// LiveKit token generation for room access
// ---------------------------------------------------------------------------

import { AccessToken } from "livekit-server-sdk";

export type LiveKitCredentials = {
  url: string;
  token: string;
};

const TOKEN_TTL_MS = 6 * 60 * 60 * 1_000;
const TOKEN_TTL = `${TOKEN_TTL_MS / 1_000}s`;
const TOKEN_REFRESH_THRESHOLD_MS = 10 * 60 * 1_000; // refresh if <10 min remaining

// Keyed by "roomName::identity". Currently single-room so this holds one entry.
// If rooms vary dynamically, add eviction logic to prevent unbounded growth.
const tokenCache = new Map<string, { credentials: LiveKitCredentials; expiresAt: number }>();

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
  const cacheKey = `${roomName}::${identity}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_THRESHOLD_MS) {
    return cached.credentials;
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: TOKEN_TTL,
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: options?.canPublish ?? true,
    canSubscribe: options?.canSubscribe ?? true,
    canPublishData: options?.canPublishData ?? true,
  });

  const jwt = await token.toJwt();
  const credentials = { url, token: jwt };

  tokenCache.set(cacheKey, {
    credentials,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  return credentials;
}
