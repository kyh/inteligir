"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@repo/ui/lib/utils";

export interface ApprovalAnswer {
  questionId: string;
  optionIds: string[];
  custom?: string;
}

interface PendingAnswer {
  questionId: string;
  optionIds: string[];
  custom: string;
}

interface ApprovalCardContextValue {
  register: (questionId: string) => void;
  answer: (questionId: string, optionIds: string[], custom: string) => void;
  picked: Record<string, string[]>;
  custom: Record<string, string>;
  submit: (pending?: PendingAnswer) => void;
  hasAnswer: boolean;
}

const ApprovalCardContext = createContext<ApprovalCardContextValue | null>(null);

function useApprovalCard(): ApprovalCardContextValue {
  const value = useContext(ApprovalCardContext);
  if (value === null) {
    throw new Error("Approval parts must render inside <ApprovalCard>");
  }
  return value;
}

interface ApprovalQuestionContextValue {
  questionId: string;
  kind: "radio" | "check";
  selected: string[];
  toggle: (optionId: string) => void;
}

const ApprovalQuestionContext = createContext<ApprovalQuestionContextValue | null>(null);

function useApprovalQuestion(): ApprovalQuestionContextValue {
  const value = useContext(ApprovalQuestionContext);
  if (value === null) {
    throw new Error("<ApprovalOption> must render inside <ApprovalQuestion>");
  }
  return value;
}

interface ApprovalCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit"> {
  onSubmit: (answers: ApprovalAnswer[]) => void;
  sentLabel?: string;
}

const ApprovalCard = forwardRef<HTMLDivElement, ApprovalCardProps>(
  ({ onSubmit, sentLabel = "Answers sent", className, children, ...props }, ref) => {
    const [order, setOrder] = useState<readonly string[]>([]);
    const [picked, setPicked] = useState<Record<string, string[]>>({});
    const [custom, setCustom] = useState<Record<string, string>>({});
    const [sent, setSent] = useState(false);

    const answered = order.filter(
      (id) => (picked[id] ?? []).length > 0 || (custom[id] ?? "").trim().length > 0,
    );

    const register = useCallback((questionId: string) => {
      setOrder((current) => (current.includes(questionId) ? current : [...current, questionId]));
    }, []);
    const answer = useCallback((questionId: string, optionIds: string[], nextCustom: string) => {
      setPicked((current) => ({ ...current, [questionId]: optionIds }));
      setCustom((current) => ({ ...current, [questionId]: nextCustom }));
    }, []);
    const submit = useCallback(
      (pending?: PendingAnswer) => {
        // a commit-on-pick answer arrives in the handler that made the pick, before state holds it
        const nextPicked =
          pending === undefined ? picked : { ...picked, [pending.questionId]: pending.optionIds };
        const nextCustom =
          pending === undefined ? custom : { ...custom, [pending.questionId]: pending.custom };
        setSent(true);
        onSubmit(
          order.map((questionId) => {
            const text = (nextCustom[questionId] ?? "").trim();
            const entry: ApprovalAnswer = { questionId, optionIds: nextPicked[questionId] ?? [] };
            return text.length > 0 ? { ...entry, custom: text } : entry;
          }),
        );
      },
      [order, picked, custom, onSubmit],
    );
    const hasAnswer = order.length > 0 && answered.length === order.length;
    const value = useMemo<ApprovalCardContextValue>(
      () => ({ register, answer, picked, custom, submit, hasAnswer }),
      [register, answer, picked, custom, submit, hasAnswer],
    );

    if (sent) {
      return (
        <div
          ref={ref}
          data-slot="approval-card"
          data-sent=""
          className={cn("flex w-full items-center gap-3 animate-in fade-in zoom-in-95", className)}
          {...props}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset py-1 pr-2.5 pl-1 text-[12.5px] font-medium text-ink">
            <span className="flex size-4.5 items-center justify-center rounded-full bg-ink text-background">
              <svg
                aria-hidden
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            {sentLabel}
          </span>
        </div>
      );
    }

    return (
      <ApprovalCardContext.Provider value={value}>
        <div
          ref={ref}
          data-slot="approval-card"
          className={cn(
            "w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </ApprovalCardContext.Provider>
    );
  },
);
ApprovalCard.displayName = "ApprovalCard";

interface ApprovalQuestionProps extends HTMLAttributes<HTMLDivElement> {
  questionId: string;
  prompt: string;
  detail?: string;
  kind?: "radio" | "check";
  action?: ReactNode;
}

const ApprovalQuestion = forwardRef<HTMLDivElement, ApprovalQuestionProps>(
  ({ questionId, prompt, detail, kind = "radio", action, className, children, ...props }, ref) => {
    const card = useApprovalCard();
    const { register } = card;
    useEffect(() => {
      register(questionId);
    }, [register, questionId]);

    const selected = card.picked[questionId] ?? [];

    const toggle = (optionId: string): void => {
      const next =
        kind === "radio"
          ? [optionId]
          : selected.includes(optionId)
            ? selected.filter((entry) => entry !== optionId)
            : [...selected, optionId];
      const nextCustom = kind === "radio" ? "" : (card.custom[questionId] ?? "");
      card.answer(questionId, next, nextCustom);
      // a single choice commits on pick, so the pick has to ride the submit
      if (kind === "radio") {
        card.submit({ questionId, optionIds: next, custom: nextCustom });
      }
    };

    const context = useMemo(
      () => ({ questionId, kind, selected, toggle }),
      // toggle closes over the current answers and is rebuilt with them on purpose
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [questionId, kind, selected, toggle],
    );

    return (
      <ApprovalQuestionContext.Provider value={context}>
        <div
          ref={ref}
          data-slot="approval-question"
          className={cn("animate-in fade-in slide-in-from-bottom-1 p-3", className)}
          {...props}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-[13px] font-medium text-ink">{prompt}</span>
              {detail === undefined ? null : (
                <span className="text-[12.5px] text-ink-2">{detail}</span>
              )}
            </span>
            {action}
          </div>
          <div className="mt-2 flex flex-col gap-0.5">{children}</div>
        </div>
      </ApprovalQuestionContext.Provider>
    );
  },
);
ApprovalQuestion.displayName = "ApprovalQuestion";

interface ApprovalOptionProps extends HTMLAttributes<HTMLButtonElement> {
  optionId: string;
}

const ApprovalOption = forwardRef<HTMLButtonElement, ApprovalOptionProps>(
  ({ optionId, className, children, ...props }, ref) => {
    const { kind, selected, toggle } = useApprovalQuestion();
    const on = selected.includes(optionId);
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={on}
        onClick={() => toggle(optionId)}
        data-slot="approval-option"
        className={cn(
          "-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-100 hover:bg-hover",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center transition-colors duration-200",
            kind === "radio" ? "rounded-full" : "rounded-[5px]",
            on
              ? "bg-ink text-background"
              : "text-transparent shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
          )}
        >
          {kind === "radio" ? (
            <span
              className={cn(
                "size-1.5 rounded-full bg-background transition-transform duration-200",
                on ? "scale-100" : "scale-0",
              )}
            />
          ) : (
            <svg
              aria-hidden
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </span>
        <span
          className={cn(
            "text-[13px] transition-colors duration-200",
            on ? "text-ink" : "text-ink-2",
          )}
        >
          {children}
        </span>
      </button>
    );
  },
);
ApprovalOption.displayName = "ApprovalOption";

const ApprovalCustomAnswer = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">
>(({ className, ...props }, ref) => {
  const card = useApprovalCard();
  const { questionId, kind, selected } = useApprovalQuestion();
  const typed = card.custom[questionId] ?? "";
  return (
    <label className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-100 focus-within:bg-hover hover:bg-hover">
      <span aria-hidden className="size-4 shrink-0" />
      <input
        ref={ref}
        value={typed}
        onChange={(event) => {
          // typing clears a radio pick, or one question would send two answers
          card.answer(questionId, kind === "radio" ? [] : selected, event.target.value);
        }}
        placeholder="Type something…"
        aria-label="Custom answer"
        data-slot="approval-custom-answer"
        className={cn(
          "min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3",
          className,
        )}
        {...props}
      />
    </label>
  );
});
ApprovalCustomAnswer.displayName = "ApprovalCustomAnswer";

const ApprovalActions = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { hasAnswer, submit } = useApprovalCard();
    return (
      <div
        ref={ref}
        data-slot="approval-actions"
        className={cn(
          "flex items-center justify-between border-t border-line px-3 py-2",
          className,
        )}
        {...props}
      >
        <span className="min-w-0">{children}</span>
        <button
          type="button"
          aria-label="Send answers"
          disabled={!hasAnswer}
          onClick={() => submit()}
          className={cn(
            "-mr-0.5 flex size-7 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]",
            hasAnswer ? "bg-ink text-background" : "bg-muted text-ink-3",
          )}
        >
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    );
  },
);
ApprovalActions.displayName = "ApprovalActions";

export { ApprovalCard, ApprovalQuestion, ApprovalOption, ApprovalCustomAnswer, ApprovalActions };
