import { useEffect, useState } from "react";
import {
  GridIcon,
  ListTodoIcon,
  MessageSquareIcon,
  MicIcon,
  PhoneIcon,
  PlugIcon,
  SettingsIcon,
} from "lucide-react";
import { cn } from "@repo/ui/lib/utils";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@repo/ui/components/ai-elements/conversation";

import { ChatActivityRow, ChatMessageView } from "@/renderer/chat/chat-message";
import { Composer } from "@/renderer/chat/composer";
import { ExtensionsPanel } from "@/renderer/chat/extensions-panel";
import { SettingsPanel } from "@/renderer/chat/settings-panel";
import { TaskPanel } from "@/renderer/chat/task-panel";
import { DraggablePanel } from "@/renderer/components/draggable-panel";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import type { VoiceState } from "@/renderer/voice/voice-machine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionTab = "message" | "voice" | "other";

// ---------------------------------------------------------------------------
// Voice labels
// ---------------------------------------------------------------------------

function voicePaneLabel(state: VoiceState): string {
  switch (state.kind) {
    case "idle":
      return "Voice";
    case "downloading_model":
      if (state.progress?.status === "downloading") {
        return `Downloading speech model… ${String(state.progress.percent)}%`;
      }
      if (state.progress?.status === "extracting") return "Extracting speech model…";
      return "Downloading speech model...";
    case "connecting":
      return "Connecting...";
    case "listening":
      return "Listening";
    case "error":
      return "Error";
  }
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
  const [activeTab, setActiveTab] = useState<ActionTab>("message");
  const [showTasks, setShowTasks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);

  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const busy = appState.phase === "ready" && appState.agent === "busy";

  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  const voiceState = useVoiceStore((s) => s.state);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const voiceActive = voiceState.kind === "listening" || voiceState.kind === "connecting";
  const voiceBusy =
    voiceState.kind === "downloading_model" || voiceState.kind === "connecting";
  const currentTranscript = voiceState.kind === "listening" ? voiceState.currentTranscript : "";

  return (
    <>
      <div className="flex h-full w-72 flex-col">
        <Conversation className="flex-1 px-3 pt-10">
          <ConversationContent className="gap-1 p-0 pb-2">
            {messages.length === 0 && !busy ? (
              <ConversationEmptyState
                title="No messages yet"
                description="Start a conversation or speak to begin."
                icon={<MessageSquareIcon className="size-6" />}
              />
            ) : (
              <>
                {messages.map((msg) => <ChatMessageView key={msg.id} message={msg} />)}
                <ChatActivityRow messages={messages} busy={busy} />
              </>
            )}
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

          {activeTab === "message" && <Composer />}

          {activeTab === "voice" && (
            <div className="bg-foreground/8 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                      voiceActive ? "bg-green-400 animate-pulse" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="text-xs text-muted-foreground">
                    {voicePaneLabel(voiceState)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={toggleVoice}
                    disabled={voiceBusy}
                    className={cn(
                      "rounded-full p-2 transition-colors",
                      voiceActive
                        ? "bg-red-500/80 text-foreground hover:bg-red-500"
                        : "bg-foreground/15 text-foreground hover:bg-foreground/25",
                      voiceBusy && "opacity-50",
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
            </div>
          )}

          {activeTab === "other" && (
            <div className="bg-foreground/8 px-3 py-2">
              <div className="grid grid-cols-4 gap-1">
                <GridOption
                  icon={ListTodoIcon}
                  label="Tasks"
                  onClick={() => setShowTasks(!showTasks)}
                />
                <GridOption
                  icon={PlugIcon}
                  label="Extensions"
                  onClick={() => setShowExtensions(!showExtensions)}
                />
                <GridOption
                  icon={SettingsIcon}
                  label="Settings"
                  onClick={() => setShowSettings(!showSettings)}
                />
              </div>
            </div>
          )}

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
        title="Extensions"
        icon={<PlugIcon className="size-3.5" />}
        isOpen={showExtensions}
        onClose={() => setShowExtensions(false)}
        initialPosition={{ x: 300, y: 40 }}
        initialSize={{ width: 360, height: 480 }}
      >
        <ExtensionsPanel />
      </DraggablePanel>

      <DraggablePanel
        title="Settings"
        icon={<SettingsIcon className="size-3.5" />}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        initialPosition={{ x: 300, y: 40 }}
        initialSize={{ width: 360, height: 320 }}
        minHeight={120}
      >
        <SettingsPanel />
      </DraggablePanel>
    </>
  );
}
