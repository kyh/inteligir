import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  ListTodoIcon,
  MenuIcon,
  MicIcon,
  MicOffIcon,
  SendIcon,
  SettingsIcon,
  SquareIcon,
} from "lucide-react";
import { cn } from "@repo/ui/utils";
import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/label";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@repo/ui/conversation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";

import { getSessionStatus } from "@/shared/agent";
import type { VoiceSessionState } from "@/shared/voice";
import { getBridge } from "@/renderer/lib/bridge";
import { ChatMessageView } from "@/renderer/chat/chat-message";
import { TaskPanel } from "@/renderer/chat/task-panel";
import { DraggablePanel } from "@/renderer/components/draggable-panel";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

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
// Voice button
// ---------------------------------------------------------------------------

const voiceLabels: Record<VoiceSessionState, string> = {
  inactive: "Voice",
  connecting: "Connecting...",
  connected: "Listening",
  error: "Error",
};

function VoiceButton() {
  const sessionState = useVoiceStore((s) => s.sessionState);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const active = sessionState === "connected" || sessionState === "connecting";
  const Icon = active ? MicIcon : MicOffIcon;

  return (
    <button
      type="button"
      onClick={toggleVoice}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-foreground/10",
        active ? "text-green-400" : "text-muted-foreground",
        sessionState === "connecting" && "animate-pulse",
      )}
      title={voiceLabels[sessionState]}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Settings content
// ---------------------------------------------------------------------------

function SettingsContent() {
  const appState = useAgentStore((s) => s.appState);
  const clearMessages = useAgentStore((s) => s.clearMessages);
  const isReady = appState.phase === "ready";

  const handleLogout = useCallback(() => {
    clearMessages();
    getBridge()?.transition({ type: "LOGOUT" });
  }, [clearMessages]);

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
// Chat page
// ---------------------------------------------------------------------------

export function ChatPage() {
  const [input, setInput] = useState("");
  const [showTasks, setShowTasks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const steer = useAgentStore((s) => s.steer);
  const interrupt = useAgentStore((s) => s.interrupt);
  const clearChat = useAgentStore((s) => s.clearChat);

  const busy = appState.phase === "ready" && appState.agent === "busy";
  const sessionStatus = getSessionStatus(appState);

  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

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
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useAgentStore.getState().clearMessages();
        clearChat();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (busy) {
          interrupt();
        } else if (input.length > 0) {
          setInput("");
        }
      }
    },
    [busy, input, interrupt, clearChat],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <>
      <div className="flex h-full w-72 flex-col">
        {/* Messages — pt for electron titlebar/traffic lights */}
        <Conversation className="flex-1 px-3 pt-10">
          <ConversationContent className="space-y-1 pb-2">
            {messages.length === 0 ? (
              <div className="px-1 py-4 text-center text-xs text-muted-foreground/60">
                No messages yet
              </div>
            ) : (
              messages.map((msg) => (
                <ChatMessageView key={msg.id} message={msg} />
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Transcript overlay */}
        {currentTranscript && (
          <div className="px-3 pb-1">
            <p className="truncate text-xs italic text-muted-foreground">
              &ldquo;{currentTranscript}&hellip;&rdquo;
            </p>
          </div>
        )}

        {/* Input bar */}
        <form onSubmit={send} className="flex items-center gap-1 border-t border-border/40 px-2 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <MenuIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={() => setShowTasks(!showTasks)}>
                <ListTodoIcon className="size-3.5" />
                Tasks
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSettings(!showSettings)}>
                <SettingsIcon className="size-3.5" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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

          <VoiceButton />

          {busy && !input.trim() ? (
            <button
              type="button"
              onClick={interrupt}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              aria-label="Stop"
            >
              <SquareIcon className="size-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              aria-label="Send"
            >
              <SendIcon className="size-3.5" />
            </button>
          )}
        </form>
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
