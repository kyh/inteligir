// Renderer registry for built-in widgets: maps each BuiltinWidgetId to the
// React component that renders its body (inside the shared Panel chrome) plus
// the icon the dock shows. The chat body lives here too so chat is just another
// built-in widget. (Metadata — title/singleton/geometry — is shared
// in @/shared/shell so main agrees on what's available.)

import {
  CalendarDaysIcon,
  LayoutGridIcon,
  ListChecksIcon,
  ListTodoIcon,
  MessageSquareIcon,
  PlugIcon,
  SettingsIcon,
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@repo/ui/components/ai-elements/conversation";

import { ChatActivityRow, ChatMessageView } from "@/renderer/shell/chat/chat-message";
import { ExtensionsPanel } from "@/renderer/shell/builtin/extensions-panel";
import { SettingsPanel } from "@/renderer/shell/builtin/settings-panel";
import { AgendaPanel } from "@/renderer/shell/builtin/agenda-panel";
import { TaskPanel } from "@/renderer/shell/builtin/task-panel";
import { TodoPanel } from "@/renderer/shell/builtin/todo-panel";
import { WidgetsPanel } from "@/renderer/shell/builtin/widgets-panel";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import type { BuiltinWidgetId } from "@/shared/shell";

function ChatWidget() {
  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const busy = appState.phase === "ready" && appState.agent === "busy";

  const voiceState = useVoiceStore((s) => s.state);
  const currentTranscript = voiceState.kind === "listening" ? voiceState.currentTranscript : "";

  return (
    <>
      <Conversation className="min-h-0 flex-1 select-text px-3 pt-2">
        <ConversationContent className="gap-1 p-0 pb-2">
          {messages.length === 0 && !busy ? (
            <ConversationEmptyState
              title="No messages yet"
              description="Start a conversation or speak to begin."
              icon={<MessageSquareIcon className="size-6" />}
            />
          ) : (
            <>
              {messages.map((msg) => (
                <ChatMessageView key={msg.id} message={msg} />
              ))}
              <ChatActivityRow messages={messages} busy={busy} />
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {currentTranscript && (
        <div className="px-3 pb-2">
          <p className="truncate text-xs italic text-muted-foreground">
            &ldquo;{currentTranscript}&hellip;&rdquo;
          </p>
        </div>
      )}
    </>
  );
}

export type BuiltinWidgetUI = {
  component: React.ComponentType;
  icon: React.ComponentType<{ className?: string }>;
  /** Extra classes for the Panel body (e.g. chat needs a flex column). */
  bodyClassName?: string;
};

export const BUILTIN_WIDGET_UI: Record<BuiltinWidgetId, BuiltinWidgetUI> = {
  chat: { component: ChatWidget, icon: MessageSquareIcon, bodyClassName: "flex flex-col" },
  widgets: { component: WidgetsPanel, icon: LayoutGridIcon },
  tasks: { component: TaskPanel, icon: ListTodoIcon },
  agenda: { component: AgendaPanel, icon: CalendarDaysIcon },
  todos: { component: TodoPanel, icon: ListChecksIcon },
  extensions: { component: ExtensionsPanel, icon: PlugIcon },
  settings: { component: SettingsPanel, icon: SettingsIcon },
};
