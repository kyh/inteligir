import { useEffect, useRef, useState } from "react";

import { MENU_ACTIONS } from "../shared/ipc";

import { getBridge } from "./bridge";
import { ChatInput } from "./chat-input";
import { ChatMessageView } from "./chat-message";
import { ErrorBoundary } from "./error-boundary";
import { GeometricOrb } from "./geometric-orb";
import { SettingsDialog } from "./settings-dialog";
import { StatusBar } from "./status-bar";
import { useAgentStore } from "./stores/agent-store";

function AppContent() {
  const messages = useAgentStore((s) => s.messages);
  const messageCount = messages.length;
  const needsSetup = useAgentStore((s) => s.needsSetup);
  const init = useAgentStore((s) => s.init);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount]);

  useEffect(() => init(), [init]);

  // Auto-open settings when no API keys configured
  useEffect(() => {
    if (needsSetup) setSettingsOpen(true);
  }, [needsSetup]);

  // Listen for menu actions (Cmd+, → open settings)
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onMenuAction((action) => {
      if (action === MENU_ACTIONS.OPEN_SETTINGS) {
        setSettingsOpen(true);
      }
    });
  }, []);

  // Re-check setup after settings dialog closes
  const handleSettingsChange = (open: boolean) => {
    setSettingsOpen(open);
    if (!open) {
      useAgentStore.getState().checkSetup();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full w-full flex-col font-mono">
      {/* Orb */}
      <div
        className="shrink-0 transition-[height] duration-300 ease-in-out"
        style={{ height: hasMessages ? "30%" : "60%", minHeight: 120 }}
      >
        <GeometricOrb />
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

      {/* Input */}
      <ChatInput />

      {/* Settings dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={handleSettingsChange} />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
