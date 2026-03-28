import { useEffect } from "react";

import { ControlIsland } from "@/renderer/chat/control-island";
import { DraggableThread } from "@/renderer/chat/draggable-thread";
import { useVoiceStore } from "@/renderer/stores/voice-store";

export function ChatPage() {
  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  return (
    <div className="relative h-full">
      <DraggableThread />

      {/* Floating control island at center bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-6">
        <ControlIsland />
      </div>
    </div>
  );
}
