import { app } from "electron";
import PartySocket from "partysocket";
import { Type } from "@sinclair/typebox";
import {
  generateRoomCode,
  PARTY_NAME,
  DEFAULT_SERVER_HOST,
  PRODUCTION_SERVER_HOST,
  parseMessage,
  encodeMessage,
  createConnectionAttemptRegistry,
} from "@repo/dispatch";
import { broadcast } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import type { DispatchState } from "@/shared/dispatch";
import { DISPATCH_INITIAL_STATE } from "@/shared/dispatch";
import type { AppAgentEvent } from "@/shared/agent-events";

// Packaged builds hit the deployed Worker; dev hits local `wrangler dev`.
// DISPATCH_SERVER_HOST overrides either (e.g. staging).
const SERVER_HOST =
  process.env["DISPATCH_SERVER_HOST"] ??
  (app.isPackaged ? PRODUCTION_SERVER_HOST : DEFAULT_SERVER_HOST);

const roomStore = new JsonStore<string | null>(
  inteligirPath("dispatch-room.json"),
  Type.Union([Type.String(), Type.Null()]),
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
  broadcast("onDispatchState", dispatchState);
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
    host: SERVER_HOST,
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
  if (!partySocket || partySocket.readyState !== WebSocket.OPEN) return;
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
