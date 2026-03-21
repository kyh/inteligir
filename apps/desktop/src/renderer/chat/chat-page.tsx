import { useEffect } from "react";

import { ChatInput } from "@/renderer/chat/chat-input";
import { MessageThread } from "@/renderer/chat/message-thread";
import { useVoiceStore } from "@/renderer/stores/voice-store";

export function ChatPage() {
  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  return (
    <div className="flex h-full">
      {/* Left: message thread spanning full height */}
      <MessageThread />

      {/* Right: main area with floating input at center bottom */}
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-6">
          <ChatInput />
        </div>
      </div>
    </div>
  );
}
