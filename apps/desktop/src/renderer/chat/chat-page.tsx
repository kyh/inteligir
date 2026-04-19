import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  GridIcon,
  ListTodoIcon,
  MessageSquareIcon,
  MicIcon,
  PhoneIcon,
  SendIcon,
  SettingsIcon,
  SquareIcon,
} from "lucide-react";
import { cn } from "@repo/ui/lib/utils";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@repo/ui/components/conversation";

import { getSessionStatus } from "@/shared/agent";
import type { VoiceSessionState } from "@/shared/voice";
import { getBridge } from "@/renderer/lib/bridge";
import { ChatMessageView } from "@/renderer/chat/chat-message";
import { TaskPanel } from "@/renderer/chat/task-panel";
import { DraggablePanel } from "@/renderer/components/draggable-panel";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionTab = "message" | "voice" | "other";

// ---------------------------------------------------------------------------
// Status indicator
// ---------------------------------------------------------------------------

const statusColors = {
  idle: "bg-green-400",
  busy: "bg-yellow-400 animate-pulse",
  error: "bg-red-400",
  starting: "bg-blue-400 animate-pulse",
} as const;

// ---------------------------------------------------------------------------
// Voice labels
// ---------------------------------------------------------------------------

const voiceLabels: Record<VoiceSessionState, string> = {
  inactive: "Voice",
  connecting: "Connecting...",
  connected: "Listening",
  error: "Error",
};

// ---------------------------------------------------------------------------
// Settings content (inline panel)
// ---------------------------------------------------------------------------

function SettingsContent() {
  const appState = useAgentStore((s) => s.appState);
  const isReady = appState.phase === "ready";

  const handleLogout = useCallback(() => {
    getBridge()?.transition({ type: "LOGOUT" });
  }, []);

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">
          OpenAI Account
        </Label>
        {isReady ? (
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-xs text-foreground">Connected</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              Log out
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">Not connected</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab icon button
// ---------------------------------------------------------------------------

function TabButton({
  icon: Icon,
  active,
  onClick,
  label,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-9 flex-1 items-center justify-center rounded-lg transition-colors",
        disabled
          ? "cursor-not-allowed text-muted-foreground/40"
          : active
            ? "bg-foreground/15 text-foreground"
            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="size-4" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Grid option button (for "other" tab)
// ---------------------------------------------------------------------------

function GridOption({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-lg p-3 transition-colors",
        disabled
          ? "cursor-not-allowed text-muted-foreground/40"
          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="text-[10px]">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chat page
// ---------------------------------------------------------------------------

export function ChatPage() {
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState<ActionTab>("message");
  const [showTasks, setShowTasks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const steer = useAgentStore((s) => s.steer);
  const interrupt = useAgentStore((s) => s.interrupt);

  const busy = appState.phase === "ready" && appState.agent === "busy";
  const sessionStatus = getSessionStatus(appState);

  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  const sessionState = useVoiceStore((s) => s.sessionState);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const voiceActive =
    sessionState === "connected" || sessionState === "connecting";

  const currentTranscript = useVoiceStore((s) => s.currentTranscript);

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
      if (e.key === "Escape") {
        e.preventDefault();
        if (busy) {
          interrupt();
        } else if (input.length > 0) {
          setInput("");
        }
      }
    },
    [busy, input, interrupt],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <>
      <div className="flex h-full w-72 flex-col">
        <Conversation className="flex-1 px-3 pt-10">
          <ConversationContent className="space-y-1 pb-2">
            {messages.map((msg) => (
              <ChatMessageView key={msg.id} message={msg} />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {currentTranscript && (
          <div className="px-3 pb-1">
            <p className="truncate text-xs italic text-muted-foreground">
              &ldquo;{currentTranscript}&hellip;&rdquo;
            </p>
          </div>
        )}

        {/* Floating action bar */}
        <div className="mx-2 mb-2 overflow-hidden rounded-2xl">
          {/* Drag handle */}
          <div className="flex items-center justify-center bg-foreground/5 py-1.5">
            <div className="h-1 w-8 rounded-full bg-foreground/20" />
          </div>

          {/* Input section */}
          <div className="bg-foreground/8 px-3 py-2">
              {activeTab === "message" && (
                <form onSubmit={send} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                      statusColors[sessionStatus],
                    )}
                  />
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={busy ? "Redirect..." : "Message..."}
                    className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                  />
                  {busy && !input.trim() ? (
                    <button
                      type="button"
                      onClick={interrupt}
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Stop"
                    >
                      <SquareIcon className="size-3.5" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Send"
                    >
                      <SendIcon className="size-3.5" />
                    </button>
                  )}
                </form>
              )}

              {activeTab === "voice" && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                        voiceActive ? "bg-green-400 animate-pulse" : "bg-muted-foreground/40",
                      )}
                    />
                    <span className="text-xs text-muted-foreground">
                      {voiceLabels[sessionState]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={toggleVoice}
                      className={cn(
                        "rounded-full p-2 transition-colors",
                        voiceActive
                          ? "bg-red-500/80 text-foreground hover:bg-red-500"
                          : "bg-foreground/15 text-foreground hover:bg-foreground/25",
                      )}
                      title={voiceActive ? "End call" : "Start call"}
                    >
                      {voiceActive ? (
                        <PhoneIcon className="size-3.5 rotate-[135deg]" />
                      ) : (
                        <MicIcon className="size-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "other" && (
                <div className="grid grid-cols-4 gap-1">
                  <GridOption
                    icon={ListTodoIcon}
                    label="Tasks"
                    onClick={() => setShowTasks(!showTasks)}
                  />
                  <GridOption
                    icon={SettingsIcon}
                    label="Settings"
                    onClick={() => setShowSettings(!showSettings)}
                  />
                </div>
              )}
            </div>

          {/* Tabs section */}
          <div className="flex items-center gap-0.5 bg-foreground/12 px-2 py-1.5">
            <TabButton
              icon={MessageSquareIcon}
              active={activeTab === "message"}
              onClick={() => setActiveTab("message")}
              label="Message"
            />
            <TabButton
              icon={PhoneIcon}
              active={activeTab === "voice"}
              onClick={() => setActiveTab("voice")}
              label="Voice"
            />
            <TabButton
              icon={GridIcon}
              active={activeTab === "other"}
              onClick={() => setActiveTab("other")}
              label="More"
            />
          </div>
        </div>
      </div>

      {/* Draggable panels */}
      <DraggablePanel
        title="Tasks"
        icon={<ListTodoIcon className="size-3.5" />}
        isOpen={showTasks}
        onClose={() => setShowTasks(false)}
        initialPosition={{ x: 300, y: 40 }}
        initialSize={{ width: 320, height: 400 }}
      >
        <TaskPanel />
      </DraggablePanel>

      <DraggablePanel
        title="Settings"
        icon={<SettingsIcon className="size-3.5" />}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        initialPosition={{ x: 300, y: 40 }}
        initialSize={{ width: 320, height: 200 }}
        minHeight={120}
      >
        <SettingsContent />
      </DraggablePanel>
    </>
  );
}
