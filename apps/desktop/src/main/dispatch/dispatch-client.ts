import PartySocket from "partysocket";
import {
  generateRoomCode,
  PARTY_NAME,
  parseMessage,
  encodeMessage,
  createConnectionAttemptRegistry,
} from "@repo/dispatch";
import { broadcastToRenderer } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import { IPC_CHANNELS } from "@/shared/ipc";
import type { DispatchState } from "@/shared/dispatch";
import { DISPATCH_INITIAL_STATE } from "@/shared/dispatch";
import type { AppAgentEvent } from "@/shared/agent-events";
import { z } from "zod";

const PARTY_HOST = process.env["DISPATCH_PARTY_HOST"] ?? "localhost:1999";

const roomStore = new JsonStore<string | null>(
  inteligirPath("dispatch-room.json"),
  z.string().nullable(),
  null,
);

let dispatchState: DispatchState = { ...DISPATCH_INITIAL_STATE };
let partySocket: PartySocket | null = null;
let onInboundMessage: ((msg: { type: string; payload: Record<string, unknown> }) => void) | null = null;
const attempts = createConnectionAttemptRegistry();

function setState(patch: Partial<DispatchState>): void {
  const hasChange = (Object.keys(patch) as (keyof DispatchState)[]).some(
    (k) => dispatchState[k] !== patch[k],
  );
  if (!hasChange) return;
  dispatchState = { ...dispatchState, ...patch };
  broadcastToRenderer(IPC_CHANNELS.DISPATCH_STATE, dispatchState);
}

export function getDispatchState(): DispatchState {
  return dispatchState;
}

function connectToRoom(roomCode: string): void {
  const attempt = attempts.begin(roomCode);

  if (partySocket) {
    partySocket.close();
    partySocket = null;
  }

  partySocket = new PartySocket({
    host: PARTY_HOST,
    party: PARTY_NAME,
    room: roomCode,
  });

  partySocket.addEventListener("message", (event) => {
    if (!attempt.isCurrent()) return;
    const msg = parseMessage(event.data);
    if (!msg || msg.direction !== "to_device") return;

    if (dispatchState.status !== "connected") {
      setState({ status: "connected", error: null });
    }

    onInboundMessage?.({ type: msg.type, payload: msg.payload });
  });

  partySocket.addEventListener("open", () => {
    if (!attempt.isCurrent()) return;
    // Only clear reconnecting state — stay in awaiting_pair until a mobile
    // device actually sends a message (handled in the message listener above).
    if (dispatchState.status === "reconnecting") {
      setState({ status: "awaiting_pair", error: null });
    }
  });

  partySocket.addEventListener("close", () => {
    if (!attempt.isCurrent()) return;
    if (dispatchState.status === "connected") {
      setState({ status: "reconnecting" });
    }
  });
}

export async function sendDispatchResponse(event: AppAgentEvent): Promise<void> {
  if (dispatchState.status !== "connected" || !partySocket) return;
  const payload = event as Record<string, unknown>;
  partySocket.send(encodeMessage("to_mobile", event.type, payload));
}

export function initDispatch(
  handler: (msg: { type: string; payload: Record<string, unknown> }) => void,
): void {
  onInboundMessage = handler;

  const savedRoom = roomStore.read();
  if (savedRoom) {
    setState({ status: "reconnecting", roomCode: savedRoom });
    connectToRoom(savedRoom);
  } else {
    const roomCode = generateRoomCode();
    roomStore.write(roomCode);
    setState({ status: "awaiting_pair", roomCode });
    connectToRoom(roomCode);
  }
}

export function refreshRoomCode(): void {
  attempts.cancel(dispatchState.roomCode ?? "");
  const roomCode = generateRoomCode();
  roomStore.write(roomCode);
  setState({ status: "awaiting_pair", roomCode, error: null });
  connectToRoom(roomCode);
}

export function shutdownDispatch(): void {
  if (partySocket) {
    attempts.cancel(dispatchState.roomCode ?? "");
    partySocket.close();
    partySocket = null;
  }
  onInboundMessage = null;
}
