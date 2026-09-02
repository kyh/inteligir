"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@repo/ui/lib/utils";

interface CodeBlockContextValue {
  code: string;
}

const CodeBlockContext = createContext<CodeBlockContextValue>({ code: "" });

export interface CodeBlockProps extends HTMLAttributes<HTMLDivElement> {
  code?: string;
}

const CodeBlock = forwardRef<HTMLDivElement, CodeBlockProps>(
  ({ className, children, code = "", ...props }, ref) => (
    <CodeBlockContext.Provider value={useMemo(() => ({ code }), [code])}>
      <div
        ref={ref}
        data-slot="code-block"
        className={cn(
          "w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-1",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </CodeBlockContext.Provider>
  ),
);
CodeBlock.displayName = "CodeBlock";

const CodeBlockHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="code-block-header"
      className={cn(
        "flex items-center justify-between gap-2 border-b border-line px-3 py-2",
        className,
      )}
      {...props}
    />
  ),
);
CodeBlockHeader.displayName = "CodeBlockHeader";

export interface CodeBlockTitleProps extends HTMLAttributes<HTMLSpanElement> {
  language?: ReactNode;
}

const CodeBlockTitle = forwardRef<HTMLSpanElement, CodeBlockTitleProps>(
  ({ className, children, language, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="code-block-title"
      className={cn("flex items-baseline gap-2", className)}
      {...props}
    >
      <span className="font-mono text-[12px] font-medium text-ink">{children}</span>
      {language === undefined ? null : <span className="text-[11.5px] text-ink-3">{language}</span>}
    </span>
  ),
);
CodeBlockTitle.displayName = "CodeBlockTitle";

const COPIED_ICON = (
  <svg
    aria-hidden
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const COPY_ICON = (
  <svg
    aria-hidden
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export interface CodeBlockCopyProps extends HTMLAttributes<HTMLButtonElement> {
  copyLabel?: string;
  copiedLabel?: string;
}

const CodeBlockCopy = forwardRef<HTMLButtonElement, CodeBlockCopyProps>(
  ({ className, copyLabel = "Copy", copiedLabel = "Copied", ...props }, ref) => {
    const { code } = useContext(CodeBlockContext);
    const [copied, setCopied] = useState(false);
    // a second copy must cancel the first reset timer
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const copy = useCallback(() => {
      void navigator.clipboard.writeText(code).then(
        () => {
          setCopied(true);
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), 1500);
          return undefined;
        },
        () => {
          setCopied(false);
          return undefined;
        },
      );
    }, [code]);

    return (
      <button
        ref={ref}
        type="button"
        aria-label={copyLabel}
        data-slot="code-block-copy"
        onClick={copy}
        className={cn(
          "flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium",
          "text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink",
          className,
        )}
        {...props}
      >
        {copied ? COPIED_ICON : COPY_ICON}
        {copied ? copiedLabel : copyLabel}
      </button>
    );
  },
);
CodeBlockCopy.displayName = "CodeBlockCopy";

const CodeBlockBody = forwardRef<HTMLPreElement, HTMLAttributes<HTMLPreElement>>(
  ({ className, ...props }, ref) => (
    <pre
      ref={ref}
      data-slot="code-block-body"
      className={cn(
        "bg-surface-inset px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] [counter-reset:code-line]",
        className,
      )}
      {...props}
    />
  ),
);
CodeBlockBody.displayName = "CodeBlockBody";

// line numbers are a css counter: an index would miscount conditionally rendered lines
const CodeBlockLine = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="code-block-line"
      className={cn(
        "flex [counter-increment:code-line]",
        "before:w-5 before:shrink-0 before:text-right before:text-[10.5px] before:leading-[1.86]",
        "before:text-ink-3/60 before:select-none before:content-[counter(code-line)]",
        className,
      )}
      {...props}
    >
      <span className="pl-2.5 whitespace-pre">{children}</span>
    </div>
  ),
);
CodeBlockLine.displayName = "CodeBlockLine";

const codeTokenVariants = cva("", {
  variants: {
    tone: {
      plain: "text-ink-2",
      keyword: "font-semibold text-ink",
      string: "text-ink-2 italic",
      number: "text-ink-2 tabular-nums",
      entity: "font-medium text-ink",
      punctuation: "text-ink-3",
    },
  },
  defaultVariants: { tone: "plain" },
});

export interface CodeTokenProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof codeTokenVariants> {}

const CodeToken = forwardRef<HTMLSpanElement, CodeTokenProps>(
  ({ className, tone, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="code-token"
      className={cn(codeTokenVariants({ tone }), className)}
      {...props}
    />
  ),
);
CodeToken.displayName = "CodeToken";

export {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockCopy,
  CodeBlockBody,
  CodeBlockLine,
  CodeToken,
  codeTokenVariants,
};
