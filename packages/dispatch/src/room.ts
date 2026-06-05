const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

export type RoomConfig = {
  host: string;
  party: string;
  room: string;
};

// partyserver routes to a Durable Object "party" derived from its class name
// (DispatchServer -> dispatch-server). This is the protocol routing key, not
// branding — it must match the server's registered DO class.
export const PARTY_NAME = "dispatch-server";

// Local `wrangler dev` port; clients derive the dev host from this.
export const SERVER_PORT = "8787";
export const DEFAULT_SERVER_HOST = `localhost:${SERVER_PORT}`;

// Deployed Cloudflare Worker (apps/server, name "inteligir-server"). Packaged
// desktop/mobile builds connect here; dev builds use DEFAULT_SERVER_HOST.
// Override per-environment via DISPATCH_SERVER_HOST / EXPO_PUBLIC_SERVER_HOST.
export const PRODUCTION_SERVER_HOST = "inteligir-server.kyh.workers.dev";

export function createRoomConfig(host: string, roomCode: string): RoomConfig {
  return { host, party: PARTY_NAME, room: roomCode };
}
