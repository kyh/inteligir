import { Dialog, DialogPopup } from "@repo/ui/components/dialog";
import { InputMessage } from "@repo/ui/components/input-message";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { toast } from "@repo/ui/components/sonner";
import { useRef, useState } from "react";
import type { RefObject } from "react";

import { failed } from "../api";
import { createAction } from "./action-service";

export interface ActionComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunched: (threadId: string) => void;
  // the workspace's centre column: the composer floats over it, never over the panel beside it
  container: RefObject<HTMLElement | null>;
}

export const ActionComposer = ({
  open,
  onOpenChange,
  onLaunched,
  container,
}: ActionComposerProps) => {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // the thread a refused send already created, which the retry sends into: the composer outlives
  // a close, so a refusal (no agent to run the turn, say) leaves one empty action, not one a try
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  const focusField = (): HTMLElement | null => {
    const field = fieldRef.current;
    field?.setSelectionRange(field.value.length, field.value.length);
    return field;
  };

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "" || sending) {
      return;
    }
    setSending(true);
    void (async () => {
      try {
        const created = await createAction({ prompt: trimmed, threadId: pendingThreadId });
        if (created.send.kind === "refused") {
          setPendingThreadId(created.threadId);
          toast.error(created.send.message);
        } else {
          setPendingThreadId(null);
          setText("");
          onOpenChange(false);
          onLaunched(created.threadId);
        }
      } catch (error) {
        failed(error, "Could not start the action.");
      }
      setSending(false);
    })();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPopup
        container={container}
        initialFocus={focusField}
        aria-label="Action composer"
        className="absolute inset-x-6 bottom-10 mx-auto max-w-xl"
      >
        <InputMessage
          value={text}
          onValueChange={setText}
          onSend={() => {
            submit();
          }}
          rightSlot={
            platformShortcutModifier() === "meta" ? (
              <span className="text-caption text-muted-foreground">fn fn to dictate</span>
            ) : null
          }
          placeholder="Ask the agent…"
          minRows={2}
          maxRows={8}
          sendLabel="Send"
          disabled={sending}
          textareaRef={fieldRef}
          textareaProps={{ "aria-label": "Ask the agent" }}
        />
      </DialogPopup>
    </Dialog>
  );
};
