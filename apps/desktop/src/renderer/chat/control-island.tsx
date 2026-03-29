import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@repo/ui/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/popover";
import {
  ListTodoIcon,
  MessageSquareIcon,
  MicIcon,
  MicOffIcon,
  MoreHorizontalIcon,
  SendIcon,
  SquareIcon,
} from "lucide-react";

import { getSessionStatus, type SessionStatus } from "@/shared/agent";
import { formatSchedule } from "@/shared/task";
import type { VoiceSessionState } from "@/shared/voice";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import { useTaskStore } from "@/renderer/stores/task-store";
import { TaskPanel } from "@/renderer/chat/task-panel";

// ---------------------------------------------------------------------------
// Animation constants
// ---------------------------------------------------------------------------

const SPRING = { type: "spring" as const, stiffness: 500, damping: 30, mass: 1 };

const CONTENT_INITIAL = { opacity: 0, scale: 0.96, filter: "blur(4px)" };
const CONTENT_ANIMATE = { opacity: 1, scale: 1, filter: "blur(0px)" };
const CONTENT_EXIT = { opacity: 0, scale: 0.96, filter: "blur(4px)" };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IslandTab = "chat" | "voice" | "tasks";

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

const statusColors: Record<SessionStatus, string> = {
  idle: "bg-green-400",
  busy: "bg-yellow-400 animate-pulse",
  error: "bg-red-400",
  starting: "bg-blue-400 animate-pulse",
};

function StatusDot({ status }: { status: SessionStatus }) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
        statusColors[status],
      )}
      role="status"
      aria-label={`Session: ${status}`}
      title={status}
    />
  );
}

// ---------------------------------------------------------------------------
// IslandTab button
// ---------------------------------------------------------------------------

function IslandTabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <motion.button
      layout
      type="button"
      onClick={onClick}
      className="relative z-[1] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
      style={{ color: active ? "hsl(0 0% 98%)" : "hsl(13 20% 80%)" }}
      aria-label={label}
    >
      {active && (
        <motion.div
          layoutId="island-tab"
          className="absolute inset-0 rounded-full bg-white/15"
          transition={SPRING}
          style={{ zIndex: -1 }}
        />
      )}
      {icon}
      <span className="hidden min-[400px]:inline">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-0.5 text-[10px] text-yellow-400">{badge}</span>
      )}
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// ChatContent
// ---------------------------------------------------------------------------

function ChatContent() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = useAgentStore(
    (s) => s.appState.phase === "ready" && s.appState.agent === "busy",
  );
  const sendMessage = useVoiceStore((s) => s.sendMessage);
  const steer = useVoiceStore((s) => s.steer);
  const interrupt = useVoiceStore((s) => s.interrupt);
  const clearChat = useVoiceStore((s) => s.clearChat);

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

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form onSubmit={send} className="flex items-center gap-2">
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={busy ? "Redirect..." : "Message..."}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
      {busy && !input.trim() ? (
        <motion.button
          type="button"
          onClick={interrupt}
          className="shrink-0 rounded-full p-1.5 text-foreground/80 transition-colors hover:bg-white/10"
          whileTap={{ scale: 0.9 }}
          aria-label="Stop"
        >
          <SquareIcon className="size-3.5" />
        </motion.button>
      ) : (
        <motion.button
          type="submit"
          className="shrink-0 rounded-full p-1.5 text-foreground/80 transition-colors hover:bg-white/10"
          whileTap={{ scale: 0.9 }}
          aria-label="Send"
        >
          <SendIcon className="size-3.5" />
        </motion.button>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// VoiceContent
// ---------------------------------------------------------------------------

const voiceStateLabels: Record<VoiceSessionState, string | null> = {
  inactive: "Tap to start",
  connecting: "Connecting...",
  connected: "Listening...",
  error: null,
};

function VoiceContent() {
  const sessionState = useVoiceStore((s) => s.sessionState);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const currentTranscript = useVoiceStore((s) => s.currentTranscript);
  const voiceError = useVoiceStore((s) => s.error);

  const active = sessionState !== "inactive" && sessionState !== "error";
  const Icon = active ? MicIcon : MicOffIcon;

  const label =
    voiceError
      ? voiceError
      : sessionState === "connected" && currentTranscript
        ? `"${currentTranscript}..."`
        : voiceStateLabels[sessionState];

  return (
    <div className="flex items-center gap-3">
      <motion.button
        type="button"
        onClick={toggleVoice}
        className={cn(
          "shrink-0 rounded-full p-2 transition-colors hover:bg-white/10",
          active ? "text-green-400" : "text-foreground/80",
          sessionState === "connecting" && "animate-pulse",
        )}
        whileTap={{ scale: 0.9 }}
        aria-label={active ? "Stop voice" : "Start voice"}
      >
        <Icon className="size-4" />
      </motion.button>
      {label && (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TasksContent
// ---------------------------------------------------------------------------

function TasksContent() {
  const tasks = useTaskStore((s) => s.tasks);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const toggleTask = useTaskStore((s) => s.toggleTask);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="flex items-center gap-2">
      {tasks.length === 0 ? (
        <span className="text-xs text-muted-foreground/60">No tasks</span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => toggleTask(task.id)}
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs transition-colors hover:bg-white/10"
              title={`${task.label} — ${formatSchedule(task.schedule)}`}
            >
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full transition-colors",
                  task.enabled ? "bg-green-400" : "bg-muted-foreground/30",
                )}
              />
              <span
                className={cn(
                  "max-w-[80px] truncate",
                  task.enabled ? "text-foreground/90" : "text-muted-foreground/60",
                )}
              >
                {task.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Full task panel via popover */}
      <Popover>
        <PopoverTrigger asChild>
          <motion.button
            type="button"
            className="shrink-0 rounded-full p-1.5 text-muted-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground"
            whileTap={{ scale: 0.9 }}
            aria-label="Manage tasks"
          >
            <MoreHorizontalIcon className="size-3.5" />
          </motion.button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-72 p-3">
          <TaskPanel embedded />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ControlIsland
// ---------------------------------------------------------------------------

export function ControlIsland() {
  const [activeTab, setActiveTab] = useState<IslandTab>("chat");
  const sessionStatus = useAgentStore((s) => getSessionStatus(s.appState));
  const sessionState = useVoiceStore((s) => s.sessionState);
  const enabledTaskCount = useTaskStore((s) => s.tasks.filter((t) => t.enabled).length);

  // Auto-switch to voice tab when voice connects, back to chat when inactive
  const prevSessionState = useRef(sessionState);
  useEffect(() => {
    const prev = prevSessionState.current;
    prevSessionState.current = sessionState;

    if (prev !== "connected" && sessionState === "connected") {
      setActiveTab("voice");
    } else if (prev !== "inactive" && sessionState === "inactive" && activeTab === "voice") {
      setActiveTab("chat");
    }
  }, [sessionState, activeTab]);

  return (
    <motion.div
      layout
      transition={SPRING}
      className="pointer-events-auto overflow-hidden rounded-[22px] border border-white/10 bg-background/60 shadow-[0_8px_32px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl"
    >
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 pt-1.5 pb-0.5">
        <StatusDot status={sessionStatus} />

        <div className="ml-1 flex items-center">
          <IslandTabButton
            active={activeTab === "chat"}
            onClick={() => setActiveTab("chat")}
            icon={<MessageSquareIcon className="size-3" />}
            label="Chat"
          />
          <IslandTabButton
            active={activeTab === "voice"}
            onClick={() => setActiveTab("voice")}
            icon={<MicIcon className="size-3" />}
            label="Voice"
          />
          <IslandTabButton
            active={activeTab === "tasks"}
            onClick={() => setActiveTab("tasks")}
            icon={<ListTodoIcon className="size-3" />}
            label="Tasks"
            badge={enabledTaskCount}
          />
        </div>
      </div>

      {/* Divider */}
      <div className="mx-3 h-px bg-white/8" />

      {/* Content area */}
      <div className="px-3 py-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {activeTab === "chat" && (
            <motion.div
              key="chat"
              initial={CONTENT_INITIAL}
              animate={CONTENT_ANIMATE}
              exit={CONTENT_EXIT}
              transition={SPRING}
            >
              <ChatContent />
            </motion.div>
          )}
          {activeTab === "voice" && (
            <motion.div
              key="voice"
              initial={CONTENT_INITIAL}
              animate={CONTENT_ANIMATE}
              exit={CONTENT_EXIT}
              transition={SPRING}
            >
              <VoiceContent />
            </motion.div>
          )}
          {activeTab === "tasks" && (
            <motion.div
              key="tasks"
              initial={CONTENT_INITIAL}
              animate={CONTENT_ANIMATE}
              exit={CONTENT_EXIT}
              transition={SPRING}
            >
              <TasksContent />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
