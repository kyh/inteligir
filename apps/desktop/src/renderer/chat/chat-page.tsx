import { useEffect, useRef } from "react";

import { GeometricOrb } from "@/renderer/components/geometric-orb";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import { ChatInput } from "@/renderer/chat/chat-input";
import { ChatMessageView } from "@/renderer/chat/chat-message";
import { StatusBar } from "@/renderer/chat/status-bar";
import { VoiceIndicator } from "@/renderer/chat/voice-indicator";

export function ChatPage() {
  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const voiceState = useVoiceStore((s) => s.sessionState);
  const initVoice = useVoiceStore((s) => s.init);

  useEffect(() => initVoice(), [initVoice]);

  // Derive display status: voice states override agent states for the orb
  const sessionStatus: import("@/shared/agent").DisplayStatus =
    voiceState === "listening" ? "listening"
    : voiceState === "speaking" ? "speaking"
    : appState.phase === "ready"
      ? (appState.agent === "busy" ? "busy" : "idle")
      : appState.phase === "error" ? "error" : "starting";
  const messageCount = messages.length;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount]);

  const hasMessages = messages.length > 0;

  return (
    <>
      {/* Orb */}
      <div
        className="shrink-0 transition-[height] duration-300 ease-in-out"
        style={{ height: hasMessages ? "30%" : "60%", minHeight: 120 }}
      >
        <GeometricOrb status={sessionStatus} />
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-6 py-2">
        {messages.map((msg) => (
          <ChatMessageView key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Voice indicator */}
      <VoiceIndicator />

      {/* Input */}
      <ChatInput />
    </>
  );
}
