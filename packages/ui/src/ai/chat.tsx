"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef } from "react";
import type { HTMLAttributes, InputHTMLAttributes, KeyboardEvent, ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

const ChatPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="chat-panel"
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-[14px] bg-surface-raised shadow-surface-2",
        className,
      )}
      {...props}
    />
  ),
);
ChatPanel.displayName = "ChatPanel";

export interface ChatPanelHeaderProps extends HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode;
}

const ChatPanelHeader = forwardRef<HTMLDivElement, ChatPanelHeaderProps>(
  ({ className, children, actions, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="chat-panel-header"
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-line p-1.5",
        className,
      )}
      {...props}
    >
      <div className="flex items-center">{children}</div>
      {actions === undefined ? null : <div className="flex items-center gap-1">{actions}</div>}
    </div>
  ),
);
ChatPanelHeader.displayName = "ChatPanelHeader";

export interface ChatTabProps extends HTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

const ChatTab = forwardRef<HTMLButtonElement, ChatTabProps>(
  ({ className, active = false, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      data-slot="chat-tab"
      className={cn(
        "rounded-md px-2 py-[3px] text-[13px] text-ink",
        "transition-[background-color,opacity] duration-100",
        active ? "bg-surface-inset" : "opacity-50 hover:opacity-75",
        className,
      )}
      {...props}
    />
  ),
);
ChatTab.displayName = "ChatTab";

const ChatPanelBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="chat-panel-body"
      className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3", className)}
      {...props}
    />
  ),
);
ChatPanelBody.displayName = "ChatPanelBody";

export interface ChatMessageProps extends HTMLAttributes<HTMLDivElement> {
  author?: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  superseded?: boolean;
}

const ChatMessage = forwardRef<HTMLDivElement, ChatMessageProps>(
  ({ className, children, author, detail, meta, superseded = false, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="chat-message"
      data-superseded={superseded ? "" : undefined}
      className={cn(
        "flex w-full flex-col gap-1.5 transition-[opacity,transform] duration-300",
        "animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none",
        superseded ? "scale-[0.985] opacity-55" : "scale-100 opacity-100",
        className,
      )}
      style={{ transformOrigin: "top left" }}
      {...props}
    >
      {author === undefined && detail === undefined && meta === undefined ? null : (
        <div className="flex items-center gap-1 text-[12px] leading-[1.3]">
          {author === undefined ? null : <span className="font-medium text-ink">{author}</span>}
          {detail === undefined ? null : <span className="text-ink-2">{detail}</span>}
          {meta === undefined ? null : <span className="text-ink">{meta}</span>}
        </div>
      )}
      <div className="text-[13px] leading-normal text-ink">{children}</div>
    </div>
  ),
);
ChatMessage.displayName = "ChatMessage";

const SEND_ICON = (
  <svg
    aria-hidden
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export interface ChatComposerProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onSubmit" | "value"
> {
  value?: string;
  onSend?: () => void;
  sendLabel?: string;
}

const ChatComposer = forwardRef<HTMLInputElement, ChatComposerProps>(
  ({ className, onSend, sendLabel = "Send", value, onKeyDown, ...props }, ref) => {
    const canSend = (value ?? "").trim().length > 0;
    const submit = () => {
      if (canSend) onSend?.();
    };
    return (
      <div
        data-slot="chat-composer"
        className="flex shrink-0 items-center gap-2 border-t border-line px-2.5 py-2"
      >
        <input
          ref={ref}
          value={value}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3",
            className,
          )}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            onKeyDown?.(event);
            if (event.defaultPrevented || event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
          {...props}
        />
        <button
          type="button"
          aria-label={sendLabel}
          data-slot="chat-composer-send"
          disabled={!canSend}
          onClick={submit}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-100",
            canSend
              ? "bg-primary text-primary-foreground"
              : "bg-surface-inset text-ink-3 opacity-60",
          )}
        >
          {SEND_ICON}
        </button>
      </div>
    );
  },
);
ChatComposer.displayName = "ChatComposer";

export { ChatPanel, ChatPanelHeader, ChatTab, ChatPanelBody, ChatMessage, ChatComposer };
