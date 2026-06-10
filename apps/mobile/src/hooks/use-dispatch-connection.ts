import { useCallback, useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import type { PairingCredential } from "@repo/dispatch/pairing";
import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  type AgentEvent,
  type DispatchMessage,
} from "@repo/dispatch/protocol";
import { buildConnectionConfig } from "@repo/dispatch/room";

import { getServerHost } from "@/utils/base-url";

/** Why reconnecting stopped for good. The screen swaps to a re-pair prompt. */
export type DispatchFatal =
  /** Desktop rotated the pairing (`error{room_closed}`): credential is dead. */
  | { kind: "room_closed" }
  /** The relay refused or rejected this connection's token. */
  | { kind: "unauthorized" }
  /** Peer speaks a different protocol version; app and desktop must match. */
  | { kind: "version_mismatch" };

export type DispatchConnection = {
  /** Relay socket state. "online" says nothing about the desktop peer. */
  socket: "connecting" | "online";
  /** An authenticated desktop peer is present in the room (via presence). */
  desktopOnline: boolean;
  /** Set when reconnecting is pointless; null while the connection is sane. */
  fatal: DispatchFatal | null;
  /** Consecutive socket closes since the last successful open (UI hint). */
  failedAttempts: number;
  send: (message: DispatchMessage) => void;
};

type UseDispatchConnectionOptions = {
  credential: PairingCredential;
  /** One transcript event from the desktop agent. */
  onAgentEvent: (event: AgentEvent) => void;
  /** Transient, non-fatal relay errors (rate limit etc.) for display. */
  onNotice: (text: string) => void;
};

/** Close codes that signal a deliberate policy refusal — the relay rejected
 * us, so retrying with the same token is pointless. The Worker refuses auth
 * with 1008 (policy violation, see apps/server/src/server.ts onConnect);
 * 4000-4999 are reserved app-defined refusals. Everything else is treated as
 * transient and retried. */
const CLOSE_POLICY_VIOLATION = 1008;
const POLICY_CLOSE_MIN = 4000;
const POLICY_CLOSE_MAX = 4999;

function isPolicyRefusal(code: number): boolean {
  return code === CLOSE_POLICY_VIOLATION || (code >= POLICY_CLOSE_MIN && code <= POLICY_CLOSE_MAX);
}

/**
 * Owns the PartySocket lifetime for one pairing credential: connects with
 * role=mobile + token (auth is connect-time, per PROTOCOL.md), parses every
 * inbound frame with `parseMessage`, tracks desktop presence, and reconnects
 * with backoff (PartySocket's built-in) until a fatal condition stops it.
 */
export function useDispatchConnection(options: UseDispatchConnectionOptions): DispatchConnection {
  const { credential } = options;
  const [socket, setSocket] = useState<"connecting" | "online">("connecting");
  const [desktopOnline, setDesktopOnline] = useState(false);
  const [fatal, setFatal] = useState<DispatchFatal | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const wsRef = useRef<PartySocket | null>(null);
  const onAgentEventRef = useRef(options.onAgentEvent);
  const onNoticeRef = useRef(options.onNotice);

  useEffect(() => {
    onAgentEventRef.current = options.onAgentEvent;
    onNoticeRef.current = options.onNotice;
  });

  useEffect(() => {
    // Fresh credential, fresh slate (matters when re-pairing in place).
    setSocket("connecting");
    setDesktopOnline(false);
    setFatal(null);
    setFailedAttempts(0);

    const ws = new PartySocket(
      buildConnectionConfig({
        host: getServerHost(),
        roomId: credential.roomId,
        role: "mobile",
        token: credential.token,
      }),
    );
    wsRef.current = ws;

    /** First fatal wins; closing stops PartySocket's reconnect loop. */
    const stop = (reason: DispatchFatal) => {
      setFatal((prev) => prev ?? reason);
      ws.close();
    };

    const handleOpen = () => {
      setSocket("online");
      setFailedAttempts(0);
    };

    const handleClose = (event: { code: number }) => {
      setSocket("connecting");
      setDesktopOnline(false);
      setFailedAttempts((n) => n + 1);
      if (isPolicyRefusal(event.code)) {
        stop({ kind: "unauthorized" });
      }
    };

    const handleMessage = (event: { data: unknown }) => {
      const result = parseMessage(event.data);
      if (!result.ok) {
        if (result.error.code === "version_mismatch") {
          // Per protocol.ts: tell the sender to upgrade, then drop the frame.
          ws.send(
            serializeMessage({
              v: PROTOCOL_VERSION,
              type: "error",
              code: "version_mismatch",
              message: `mobile speaks protocol v${PROTOCOL_VERSION}`,
            }),
          );
          stop({ kind: "version_mismatch" });
        }
        return;
      }
      const message = result.message;
      switch (message.type) {
        case "presence":
          setDesktopOnline(message.peers.some((peer) => peer.role === "desktop"));
          break;
        case "peer_joined":
          if (message.role === "desktop") setDesktopOnline(true);
          break;
        case "peer_left":
          if (message.role === "desktop") setDesktopOnline(false);
          break;
        case "agent_event":
          onAgentEventRef.current(message.event);
          break;
        case "error":
          switch (message.code) {
            case "room_closed":
              stop({ kind: "room_closed" });
              break;
            case "unauthorized":
              stop({ kind: "unauthorized" });
              break;
            case "version_mismatch":
              stop({ kind: "version_mismatch" });
              break;
            case "invalid_message":
            case "payload_too_large":
            case "rate_limited":
              onNoticeRef.current(`Relay error: ${message.message}`);
              break;
          }
          break;
        // Frames addressed to other roles — the relay broadcasts to every
        // peer; peers ignore types not addressed to them (PROTOCOL.md).
        case "user_message":
        case "steer":
        case "interrupt":
        case "chat_message":
        case "chat_reply":
        case "room_teardown":
          break;
      }
    };

    ws.addEventListener("open", handleOpen);
    ws.addEventListener("close", handleClose);
    ws.addEventListener("message", handleMessage);

    return () => {
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("close", handleClose);
      ws.removeEventListener("message", handleMessage);
      wsRef.current = null;
      ws.close();
    };
  }, [credential.roomId, credential.token]);

  const send = useCallback((message: DispatchMessage) => {
    wsRef.current?.send(serializeMessage(message));
  }, []);

  return { socket, desktopOnline, fatal, failedAttempts, send };
}
