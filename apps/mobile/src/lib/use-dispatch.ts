import { useCallback, useEffect, useRef, useState } from "react";
import { useTRPC } from "./trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DispatchMessage = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type AgentEvent = {
  type:
    | "agent_start"
    | "agent_end"
    | "message_start"
    | "message_update"
    | "message_end"
    | "tool_execution_start"
    | "tool_execution_end"
    | "sidecar_error";
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Hook: useDispatch
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2_000;

/**
 * Hook that manages the dispatch connection to a paired desktop device.
 *
 * Usage:
 * ```tsx
 * const { events, sendMessage, steer, interrupt, isConnected } = useDispatch(deviceId);
 * ```
 */
export function useDispatch(deviceId: string | null) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [isAgentBusy, setIsAgentBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -- Send message (mobile → desktop) ----------------------------------------

  const sendMessageMutation = useMutation(
    trpc.dispatch.sendMessage.mutationOptions({
      onSuccess: () => {
        // Clear previous events for a new interaction
        setEvents([]);
        setAssistantText("");
      },
    }),
  );

  const sendMessage = useCallback(
    (text: string) => {
      if (!deviceId) return;
      sendMessageMutation.mutate({
        deviceId,
        type: "user_message",
        payload: { text },
      });
    },
    [deviceId, sendMessageMutation],
  );

  const steer = useCallback(
    (text: string) => {
      if (!deviceId) return;
      sendMessageMutation.mutate({
        deviceId,
        type: "steer",
        payload: { text },
      });
    },
    [deviceId, sendMessageMutation],
  );

  const interrupt = useCallback(() => {
    if (!deviceId) return;
    sendMessageMutation.mutate({
      deviceId,
      type: "interrupt",
      payload: {},
    });
  }, [deviceId, sendMessageMutation]);

  // -- Poll responses (desktop → mobile) --------------------------------------

  const pollMutation = useMutation(
    trpc.dispatch.pollResponses.mutationOptions({
      onSuccess: (data) => {
        if (data.messages.length === 0) return;

        const newEvents = data.messages.map((m) => m.payload as AgentEvent);
        setEvents((prev) => [...prev, ...newEvents]);

        // Process events to build assistant text
        for (const event of newEvents) {
          switch (event.type) {
            case "agent_start":
              setIsAgentBusy(true);
              break;
            case "agent_end":
              setIsAgentBusy(false);
              break;
            case "message_start":
              if (event.role === "assistant") setAssistantText("");
              break;
            case "message_update":
              if (typeof event.delta === "string") {
                setAssistantText((prev) => prev + event.delta);
              }
              break;
            case "message_end":
              if (typeof event.text === "string") {
                setAssistantText(event.text);
              }
              break;
          }
        }
      },
    }),
  );

  // Start/stop polling when deviceId changes
  useEffect(() => {
    if (!deviceId) return;

    const poll = () => {
      pollMutation.mutate({ deviceId });
    };

    // Immediate first poll
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    events,
    assistantText,
    isAgentBusy,
    sendMessage,
    steer,
    interrupt,
    isSending: sendMessageMutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// Hook: useDevices — list paired devices
// ---------------------------------------------------------------------------

export function useDevices() {
  const trpc = useTRPC();
  return useQuery(trpc.dispatch.listDevices.queryOptions());
}

// ---------------------------------------------------------------------------
// Hook: usePairDevice — pair a new device with a code
// ---------------------------------------------------------------------------

export function usePairDevice() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.dispatch.pair.mutationOptions({
      onSuccess: () => {
        // Invalidate device list so it picks up the new device
        void queryClient.invalidateQueries({ queryKey: [["dispatch", "listDevices"]] });
      },
    }),
  );
}
