import { useEffect } from "react";

import { ChatInput } from "@/renderer/chat/chat-input";
import { DraggableThread } from "@/renderer/chat/draggable-thread";
import { useVoiceStore } from "@/renderer/stores/voice-store";

export function ChatPage() {
  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  return (
    <div className="relative h-full">
      <DraggableThread />

      {/* Floating input at center bottom */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center p-6">
        <ChatInput />
      </div>
    </div>
  );
}
