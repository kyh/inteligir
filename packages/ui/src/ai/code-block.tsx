"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { CheckIcon, CopyIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/cn";

interface CodeBlockContextValue {
  code: string;
}

const CodeBlockContext = createContext<CodeBlockContextValue | null>(null);

const useCodeBlock = (): CodeBlockContextValue => {
  const value = useContext(CodeBlockContext);
  if (value === null) {
    throw new Error("<CodeBlockCopy> must render inside <CodeBlock>");
  }
  return value;
};

// required: the copy reads this source, never the rendered tokens
export interface CodeBlockProps extends HTMLAttributes<HTMLDivElement> {
  code: string;
}

const CodeBlock = ({
  className,
  children,
  code,
  ref,
  ...props
}: CodeBlockProps & RefAttributes<HTMLDivElement>) => (
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
);
CodeBlock.displayName = "CodeBlock";

const CodeBlockHeader = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="code-block-header"
    className={cn(
      "flex items-center justify-between gap-2 border-b border-line px-3 py-2",
      className,
    )}
    {...props}
  />
);
CodeBlockHeader.displayName = "CodeBlockHeader";

export interface CodeBlockTitleProps extends HTMLAttributes<HTMLSpanElement> {
  language?: ReactNode;
}

const CodeBlockTitle = ({
  className,
  children,
  language,
  ref,
  ...props
}: CodeBlockTitleProps & RefAttributes<HTMLSpanElement>) => (
  <span
    ref={ref}
    data-slot="code-block-title"
    className={cn("flex items-baseline gap-2", className)}
    {...props}
  >
    <span className="font-mono text-[12px] font-medium text-ink">{children}</span>
    {language === undefined ? null : <span className="text-[11.5px] text-ink-3">{language}</span>}
  </span>
);
CodeBlockTitle.displayName = "CodeBlockTitle";

// onClick is omitted: a forwarded one would replace the copy the label promises
export interface CodeBlockCopyProps extends Omit<HTMLAttributes<HTMLButtonElement>, "onClick"> {
  copyLabel?: string;
  copiedLabel?: string;
}

const CodeBlockCopy = ({
  className,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  ref,
  ...props
}: CodeBlockCopyProps & RefAttributes<HTMLButtonElement>) => {
  const { code } = useCodeBlock();
  const [copied, setCopied] = useState(false);
  // a second copy must cancel the first reset timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  }, [code]);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={copyLabel}
      data-slot="code-block-copy"
      onClick={() => {
        void copy();
      }}
      className={cn(
        "flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium",
        "text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink",
        className,
      )}
      {...props}
    >
      {copied ? <CheckIcon size={10} strokeWidth={3} /> : <CopyIcon size={10} strokeWidth={2} />}
      {copied ? copiedLabel : copyLabel}
    </button>
  );
};
CodeBlockCopy.displayName = "CodeBlockCopy";

const CodeBlockBody = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLPreElement> & RefAttributes<HTMLPreElement>) => (
  <pre
    ref={ref}
    data-slot="code-block-body"
    className={cn(
      "bg-surface-inset px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] [counter-reset:code-line]",
      className,
    )}
    {...props}
  />
);
CodeBlockBody.displayName = "CodeBlockBody";

// line numbers are a css counter: an index would miscount conditionally rendered lines
const CodeBlockLine = ({
  className,
  children,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
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
);
CodeBlockLine.displayName = "CodeBlockLine";

const codeTokenVariants = cva("", {
  defaultVariants: { tone: "plain" },
  variants: {
    tone: {
      entity: "font-medium text-ink",
      keyword: "font-semibold text-ink",
      number: "text-ink-2 tabular-nums",
      plain: "text-ink-2",
      punctuation: "text-ink-3",
      string: "text-ink-2 italic",
    },
  },
});

export interface CodeTokenProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof codeTokenVariants> {}

const CodeToken = ({
  className,
  tone,
  ref,
  ...props
}: CodeTokenProps & RefAttributes<HTMLSpanElement>) => (
  <span
    ref={ref}
    data-slot="code-token"
    className={cn(codeTokenVariants({ tone }), className)}
    {...props}
  />
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
