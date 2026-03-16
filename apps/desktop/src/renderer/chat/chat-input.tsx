import { useCallback, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { MessageSquareTextIcon, SendIcon, SquareIcon } from "lucide-react";

import { useAgentStore } from "@/renderer/stores/agent-store";

export function ChatInput({
  showText,
  onToggleText,
}: {
  showText: boolean;
  onToggleText: () => void;
}) {
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
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        clearMessages();
        return;
      }

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
    <form onSubmit={send} className="flex items-center gap-2">
      <Button
        type="button"
        variant={showText ? "secondary" : "ghost"}
        size="icon"
        onClick={onToggleText}
        className="shrink-0"
        title={showText ? "Hide text mode" : "Show text mode"}
      >
        <MessageSquareTextIcon className="size-4" />
      </Button>
      <div className="bg-input/40 flex flex-1 items-center gap-1 rounded-md px-1 backdrop-blur-sm">
        <Input
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={busy ? "Redirect the agent..." : "Send a message..."}
          className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0"
        />
        {busy && !input.trim() ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={interrupt}
            className="shrink-0"
          >
            <SquareIcon className="size-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            disabled={!input.trim() && !busy}
            className="shrink-0"
          >
            <SendIcon className="size-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
