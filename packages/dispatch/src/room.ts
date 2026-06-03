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

export const PARTY_NAME = "dispatch-server";
export const DEFAULT_PARTY_HOST = "localhost:8787";

export function createRoomConfig(host: string, roomCode: string): RoomConfig {
  return { host, party: PARTY_NAME, room: roomCode };
}
