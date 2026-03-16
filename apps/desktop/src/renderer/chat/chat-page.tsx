import { useEffect, useRef, useState } from "react";

import { GeometricOrb } from "@/renderer/components/geometric-orb";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { ChatInput } from "@/renderer/chat/chat-input";
import { ChatMessageView } from "@/renderer/chat/chat-message";
import { StatusBar } from "@/renderer/chat/status-bar";

export function ChatPage() {
  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const sessionStatus =
    appState.phase === "ready"
      ? appState.agent === "busy"
        ? "busy"
        : "idle"
      : appState.phase === "error"
        ? "error"
        : "starting";
  const messageCount = messages.length;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount]);

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Orb fills the background */}
      <div className="absolute inset-0">
        <GeometricOrb status={sessionStatus} />
      </div>

      {/* Foreground overlay */}
      <div className="relative z-10 flex h-full flex-col">
        {/* Messages area - floating on the left */}
        <div className="flex-1 overflow-hidden">
          {showText && (
            <div className="flex h-full max-w-sm flex-col justify-end p-4">
              <div className="flex flex-col gap-1.5 overflow-y-auto">
                {messages.map((msg) => (
                  <ChatMessageView key={msg.id} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* Bottom section */}
        <div className="w-full max-w-sm p-4 pt-0">
          <ChatInput showText={showText} onToggleText={() => setShowText((v) => !v)} />
          <StatusBar />
        </div>
      </div>
    </div>
  );
}
