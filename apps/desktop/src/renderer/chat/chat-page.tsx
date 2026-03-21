import { useEffect } from "react";

import { ChatInput } from "@/renderer/chat/chat-input";
import { MessageThread } from "@/renderer/chat/message-thread";
import { useVoiceStore } from "@/renderer/stores/voice-store";

export function ChatPage() {
  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  return (
    <div className="grid h-full grid-cols-[18rem_1fr] grid-rows-[1fr_auto]">
      {/* Left: message thread spanning both rows */}
      <div className="row-span-2">
        <MessageThread />
      </div>

      {/* Right top: empty space (orb shows through from AppLayout) */}
      <div />

      {/* Right bottom: floating input */}
      <div className="flex items-end justify-center p-6">
        <ChatInput />
      </div>
    </div>
  );
}
