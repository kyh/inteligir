"use client";

import type {
  ComponentProps,
  HTMLAttributes,
  KeyboardEventHandler,
} from "react";
import type { Options } from "react-markdown";
import {
  Children,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/avatar";
import { Button } from "@repo/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import {
  ArrowDownIcon,
  ChevronDownIcon,
  Loader2Icon,
  SendIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

import type { BundledLanguage, CodeBlockProps } from "./code-block";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
  CodeBlockSelect,
  CodeBlockSelectContent,
  CodeBlockSelectItem,
  CodeBlockSelectTrigger,
  CodeBlockSelectValue,
} from "./code-block";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible";

export type AIConversationProps = ComponentProps<typeof StickToBottom>;

export const AIConversation = ({
  className,
  ...props
}: AIConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-auto", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);
export type AIConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;
export const AIConversationContent = ({
  className,
  ...props
}: AIConversationContentProps) => (
  <StickToBottom.Content className={cn("p-4", className)} {...props} />
);
export const AIConversationScrollButton = () => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);
  return (
    !isAtBottom && (
      <Button
        className="absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full"
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};

export type AIMessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant" | "system";
};
export const AIMessage = ({ className, from, ...props }: AIMessageProps) => (
  <div
    className={cn(
      "group flex w-full items-end justify-end gap-2 py-4",
      from === "user" ? "is-user" : "is-assistant flex-row-reverse justify-end",
      "[&>div]:max-w-[80%]",
      className,
    )}
    {...props}
  />
);
export type AIMessageContentProps = HTMLAttributes<HTMLDivElement>;
export const AIMessageContent = ({
  children,
  className,
  ...props
}: AIMessageContentProps) => (
  <div
    className={cn(
      "flex flex-col gap-2 rounded-lg px-4 py-3 text-sm",
      "bg-muted text-foreground",
      "group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground",
      className,
    )}
    {...props}
  >
    <div className="is-user:dark">{children}</div>
  </div>
);
export type AIMessageAvatarProps = ComponentProps<typeof Avatar> & {
  src: string;
  name?: string;
};
export const AIMessageAvatar = ({
  src,
  name,
  className,
  ...props
}: AIMessageAvatarProps) => (
  <Avatar className={cn("size-8", className)} {...props}>
    <AvatarImage alt="" className="mt-0 mb-0" src={src} />
    <AvatarFallback>{name?.slice(0, 2) || "ME"}</AvatarFallback>
  </Avatar>
);

type UseAutoResizeTextareaProps = {
  minHeight: number;
  maxHeight?: number;
};
const useAutoResizeTextarea = ({
  minHeight,
  maxHeight,
}: UseAutoResizeTextareaProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      if (reset) {
        textarea.style.height = `${minHeight}px`;
        return;
      }
      // Temporarily shrink to get the right scrollHeight
      textarea.style.height = `${minHeight}px`;
      // Calculate new height
      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY),
      );
      textarea.style.height = `${newHeight}px`;
    },
    [minHeight, maxHeight],
  );
  useEffect(() => {
    // Set initial height
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = `${minHeight}px`;
    }
  }, [minHeight]);
  // Adjust height on window resize
  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [adjustHeight]);
  return { textareaRef, adjustHeight };
};
export type AIInputProps = HTMLAttributes<HTMLFormElement>;
export const AIInput = ({ className, ...props }: AIInputProps) => (
  <form
    className={cn(
      "bg-background w-full divide-y overflow-hidden rounded-xl border shadow-sm",
      className,
    )}
    {...props}
  />
);
export type AIInputTextareaProps = ComponentProps<typeof Textarea> & {
  minHeight?: number;
  maxHeight?: number;
};
export const AIInputTextarea = ({
  onChange,
  className,
  placeholder = "What would you like to know?",
  minHeight = 48,
  maxHeight = 164,
  ...props
}: AIInputTextareaProps) => {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight,
    maxHeight,
  });
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };
  return (
    <Textarea
      className={cn(
        "w-full resize-none rounded-none border-none p-3 shadow-none ring-0 outline-none",
        "bg-transparent dark:bg-transparent",
        "focus-visible:ring-0",
        className,
      )}
      name="message"
      onChange={(e) => {
        adjustHeight();
        onChange?.(e);
      }}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      ref={textareaRef}
      {...props}
    />
  );
};
export type AIInputToolbarProps = HTMLAttributes<HTMLDivElement>;
export const AIInputToolbar = ({
  className,
  ...props
}: AIInputToolbarProps) => (
  <div
    className={cn("flex items-center justify-between p-1", className)}
    {...props}
  />
);
export type AIInputToolsProps = HTMLAttributes<HTMLDivElement>;
export const AIInputTools = ({ className, ...props }: AIInputToolsProps) => (
  <div
    className={cn(
      "flex items-center gap-1",
      "[&_button:first-child]:rounded-bl-xl",
      className,
    )}
    {...props}
  />
);
export type AIInputButtonProps = ComponentProps<typeof Button>;
export const AIInputButton = ({
  variant = "ghost",
  className,
  size,
  ...props
}: AIInputButtonProps) => {
  const newSize = (size ?? Children.count(props.children) > 1) ? "md" : "icon";
  return (
    <Button
      className={cn(
        "shrink-0 gap-1.5 rounded-lg",
        variant === "ghost" && "text-muted-foreground",
        newSize === "md" && "px-3",
        className,
      )}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  );
};
export type AIInputSubmitProps = ComponentProps<typeof Button> & {
  status?: "submitted" | "streaming" | "ready" | "error";
};
export const AIInputSubmit = ({
  className,
  variant = "secondary",
  size = "icon",
  status,
  children,
  ...props
}: AIInputSubmitProps) => {
  let Icon = <SendIcon className="size-4" />;
  if (status === "submitted") {
    Icon = <Loader2Icon className="size-4 animate-spin" />;
  } else if (status === "streaming") {
    Icon = <SquareIcon className="size-4" />;
  } else if (status === "error") {
    Icon = <XIcon className="size-4" />;
  }
  return (
    <Button
      className={cn("gap-1.5 rounded-lg rounded-br-xl", className)}
      size={size}
      type="submit"
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </Button>
  );
};
export type AIInputModelSelectProps = ComponentProps<typeof Select>;
export const AIInputModelSelect = (props: AIInputModelSelectProps) => (
  <Select {...props} />
);
export type AIInputModelSelectTriggerProps = ComponentProps<
  typeof SelectTrigger
>;
export const AIInputModelSelectTrigger = ({
  className,
  ...props
}: AIInputModelSelectTriggerProps) => (
  <SelectTrigger
    className={cn(
      "text-muted-foreground border-none bg-transparent font-medium shadow-none transition-colors",
      'hover:bg-accent hover:text-foreground [&[aria-expanded="true"]]:bg-accent [&[aria-expanded="true"]]:text-foreground',
      className,
    )}
    {...props}
  />
);
export type AIInputModelSelectContentProps = ComponentProps<
  typeof SelectContent
>;
export const AIInputModelSelectContent = ({
  className,
  ...props
}: AIInputModelSelectContentProps) => (
  <SelectContent className={cn(className)} {...props} />
);
export type AIInputModelSelectItemProps = ComponentProps<typeof SelectItem>;
export const AIInputModelSelectItem = ({
  className,
  ...props
}: AIInputModelSelectItemProps) => (
  <SelectItem className={cn(className)} {...props} />
);
export type AIInputModelSelectValueProps = ComponentProps<typeof SelectValue>;
export const AIInputModelSelectValue = ({
  className,
  ...props
}: AIInputModelSelectValueProps) => (
  <SelectValue className={cn(className)} {...props} />
);

export type AIResponseProps = HTMLAttributes<HTMLDivElement> & {
  options?: Options;
  children: Options["children"];
};
const components: Options["components"] = {
  ol: ({ node, children, className, ...props }) => (
    <ol className={cn("ml-4 list-outside list-decimal", className)} {...props}>
      {children}
    </ol>
  ),
  li: ({ node, children, className, ...props }) => (
    <li className={cn("py-1", className)} {...props}>
      {children}
    </li>
  ),
  ul: ({ node, children, className, ...props }) => (
    <ul className={cn("ml-4 list-outside list-decimal", className)} {...props}>
      {children}
    </ul>
  ),
  strong: ({ node, children, className, ...props }) => (
    <span className={cn("font-semibold", className)} {...props}>
      {children}
    </span>
  ),
  a: ({ node, children, className, ...props }) => (
    <a
      className={cn("text-primary font-medium underline", className)}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  ),
  h1: ({ node, children, className, ...props }) => (
    <h1
      className={cn("mt-6 mb-2 text-3xl font-semibold", className)}
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ node, children, className, ...props }) => (
    <h2
      className={cn("mt-6 mb-2 text-2xl font-semibold", className)}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ node, children, className, ...props }) => (
    <h3 className={cn("mt-6 mb-2 text-xl font-semibold", className)} {...props}>
      {children}
    </h3>
  ),
  h4: ({ node, children, className, ...props }) => (
    <h4 className={cn("mt-6 mb-2 text-lg font-semibold", className)} {...props}>
      {children}
    </h4>
  ),
  h5: ({ node, children, className, ...props }) => (
    <h5
      className={cn("mt-6 mb-2 text-base font-semibold", className)}
      {...props}
    >
      {children}
    </h5>
  ),
  h6: ({ node, children, className, ...props }) => (
    <h6 className={cn("mt-6 mb-2 text-sm font-semibold", className)} {...props}>
      {children}
    </h6>
  ),
  pre: ({ node, className, children }) => {
    let language = "javascript";
    if (typeof node?.properties?.className === "string") {
      language = node.properties.className.replace("language-", "");
    }
    const childrenIsCode =
      typeof children === "object" &&
      children !== null &&
      "type" in children &&
      children.type === "code";
    if (!childrenIsCode) {
      return <pre>{children}</pre>;
    }
    const data: CodeBlockProps["data"] = [
      {
        language,
        filename: "index.js",
        code: (children.props as { children: string }).children,
      },
    ];
    return (
      <CodeBlock
        className={cn("my-4 h-auto", className)}
        data={data}
        defaultValue={data[0]?.language}
      >
        <CodeBlockHeader>
          <CodeBlockFiles>
            {(item) => (
              <CodeBlockFilename key={item.language} value={item.language}>
                {item.filename}
              </CodeBlockFilename>
            )}
          </CodeBlockFiles>
          <CodeBlockSelect>
            <CodeBlockSelectTrigger>
              <CodeBlockSelectValue />
            </CodeBlockSelectTrigger>
            <CodeBlockSelectContent>
              {(item) => (
                <CodeBlockSelectItem key={item.language} value={item.language}>
                  {item.language}
                </CodeBlockSelectItem>
              )}
            </CodeBlockSelectContent>
          </CodeBlockSelect>
          <CodeBlockCopyButton
            onCopy={() => console.log("Copied code to clipboard")}
            onError={() => console.error("Failed to copy code to clipboard")}
          />
        </CodeBlockHeader>
        <CodeBlockBody>
          {(item) => (
            <CodeBlockItem key={item.language} value={item.language}>
              <CodeBlockContent language={item.language as BundledLanguage}>
                {item.code}
              </CodeBlockContent>
            </CodeBlockItem>
          )}
        </CodeBlockBody>
      </CodeBlock>
    );
  },
};
export const AIResponse = memo(
  ({ className, options, children, ...props }: AIResponseProps) => (
    <div
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
    >
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm]}
        {...options}
      >
        {children}
      </ReactMarkdown>
    </div>
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

type AIReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number;
};
const AIReasoningContext = createContext<AIReasoningContextValue | null>(null);
const useAIReasoning = () => {
  const context = useContext(AIReasoningContext);
  if (!context) {
    throw new Error("AIReasoning components must be used within AIReasoning");
  }
  return context;
};
export type AIReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};
export const AIReasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = false,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: AIReasoningProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    });
    const [duration, setDuration] = useControllableState({
      prop: durationProp,
      defaultProp: 0,
    });
    const [hasAutoClosedRef, setHasAutoClosedRef] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);
    // Track duration when streaming starts and ends
    useEffect(() => {
      if (isStreaming) {
        if (startTime === null) {
          setStartTime(Date.now());
        }
      } else if (startTime !== null) {
        setDuration(Math.round((Date.now() - startTime) / 1000));
        setStartTime(null);
      }
    }, [isStreaming, startTime, setDuration]);
    // Auto-open when streaming starts, auto-close when streaming ends (once only)
    useEffect(() => {
      if (isStreaming && !isOpen) {
        setIsOpen(true);
      } else if (!isStreaming && isOpen && !defaultOpen && !hasAutoClosedRef) {
        // Add a small delay before closing to allow user to see the content
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosedRef(true);
        }, 1000);
        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosedRef]);
    const handleOpenChange = (open: boolean) => {
      setIsOpen(open);
    };
    return (
      <AIReasoningContext.Provider
        value={{ isStreaming, isOpen, setIsOpen, duration }}
      >
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </AIReasoningContext.Provider>
    );
  },
);
export type AIReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  title?: string;
};
export const AIReasoningTrigger = memo(
  ({
    className,
    title = "Reasoning",
    children,
    ...props
  }: AIReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useAIReasoning();
    return (
      <CollapsibleTrigger
        className={cn(
          "text-muted-foreground flex items-center gap-2 text-sm",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            {isStreaming && duration === 0 ? (
              <p>Thinking...</p>
            ) : (
              <p>Thought for {duration} seconds</p>
            )}
            <ChevronDownIcon
              className={cn(
                "text-muted-foreground size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0",
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  },
);
export type AIReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string;
};
export const AIReasoningContent = memo(
  ({ className, children, ...props }: AIReasoningContentProps) => (
    <CollapsibleContent
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    >
      <AIResponse className="grid gap-2">{children}</AIResponse>
    </CollapsibleContent>
  ),
);
AIReasoning.displayName = "AIReasoning";
AIReasoningTrigger.displayName = "AIReasoningTrigger";
AIReasoningContent.displayName = "AIReasoningContent";
