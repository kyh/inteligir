import { useCallback, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";

import { useAgentStore } from "@/renderer/stores/agent-store";
import { VoiceButton } from "@/renderer/chat/voice-button";

export function ChatInput() {
  const [input, setInput] = useState("");
  const busy = useAgentStore((s) => s.appState.phase === "ready" && s.appState.agent === "busy");
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const steer = useAgentStore((s) => s.steer);
  const interrupt = useAgentStore((s) => s.interrupt);
  const clearMessages = useAgentStore((s) => s.clearMessages);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value),
    [],
  );

  const send = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput("");
      if (busy) {
        steer(text);
      } else {
        sendMessage(text);
      }
    },
    [input, busy, sendMessage, steer],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      // Cmd+K / Ctrl+K — clear messages
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        clearMessages();
        return;
      }

      // Escape — interrupt agent or clear input
      if (e.key === "Escape") {
        e.preventDefault();
        if (busy) {
          interrupt();
        } else if (input.length > 0) {
          setInput("");
        }
        return;
      }
    },
    [busy, input, interrupt, clearMessages],
  );

  return (
    <form onSubmit={send} className="flex shrink-0 gap-2 px-6 pt-3 pb-6">
      <Input
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={busy ? "Redirect the agent..." : "Send a message..."}
        className="flex-1"
      />
      <VoiceButton />
      {busy ? (
        input.trim() ? (
          <Button type="submit">Steer</Button>
        ) : (
          <Button type="button" variant="destructive" onClick={interrupt}>
            Stop
          </Button>
        )
      ) : (
        <Button type="submit" disabled={input.trim() === ""}>
          Send
        </Button>
      )}
    </form>
  );
}
