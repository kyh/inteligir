"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { HTMLAttributes, RefAttributes } from "react";
import { CheckIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/cn";

export interface ApprovalAnswer {
  questionId: string;
  optionIds: string[];
}

interface ApprovalCardContextValue {
  register: (questionId: string) => void;
  answer: (questionId: string, optionIds: string[]) => void;
  picked: Record<string, string[]>;
  submit: (pending: ApprovalAnswer) => void;
  sending: boolean;
}

const ApprovalCardContext = createContext<ApprovalCardContextValue | null>(null);

const useApprovalCard = (): ApprovalCardContextValue => {
  const value = useContext(ApprovalCardContext);
  if (value === null) {
    throw new Error("Approval parts must render inside <ApprovalCard>");
  }
  return value;
};

interface ApprovalQuestionContextValue {
  selected: string[];
  pick: (optionId: string) => void;
}

const ApprovalQuestionContext = createContext<ApprovalQuestionContextValue | null>(null);

// a shared empty array so an unanswered question keeps a stable `selected` identity
const noSelection: string[] = [];

const useApprovalQuestion = (): ApprovalQuestionContextValue => {
  const value = useContext(ApprovalQuestionContext);
  if (value === null) {
    throw new Error("<ApprovalOption> must render inside <ApprovalQuestion>");
  }
  return value;
};

// the card reads "sent" only once the answer landed: a returned promise holds the options
// disabled while it runs, and a rejection hands them back so the answer can be retried.
type ApprovalCardStatus = "open" | "sending" | "sent";

interface ApprovalCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit"> {
  onSubmit: (answers: ApprovalAnswer[]) => void | Promise<void>;
  sentLabel?: string;
}

const ApprovalCard = ({
  onSubmit,
  sentLabel = "Answers sent",
  className,
  children,
  ref,
  ...props
}: ApprovalCardProps & RefAttributes<HTMLDivElement>) => {
  const [order, setOrder] = useState<readonly string[]>([]);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<ApprovalCardStatus>("open");

  const register = useCallback((questionId: string) => {
    setOrder((current) => (current.includes(questionId) ? current : [...current, questionId]));
  }, []);
  const answer = useCallback((questionId: string, optionIds: string[]) => {
    setPicked((current) => ({ ...current, [questionId]: optionIds }));
  }, []);
  const submit = useCallback(
    (pending: ApprovalAnswer) => {
      // the pick arrives in the handler that made it, before state holds it
      const nextPicked = { ...picked, [pending.questionId]: pending.optionIds };
      const answers = order.map((questionId): ApprovalAnswer => ({
        optionIds: nextPicked[questionId] ?? [],
        questionId,
      }));
      setStatus("sending");
      void (async () => {
        try {
          await onSubmit(answers);
          setStatus("sent");
        } catch {
          setStatus("open");
        }
      })();
    },
    [order, picked, onSubmit],
  );
  const sending = status === "sending";
  const value = useMemo<ApprovalCardContextValue>(
    () => ({ answer, picked, register, sending, submit }),
    [register, answer, picked, submit, sending],
  );

  if (status === "sent") {
    return (
      <div
        ref={ref}
        data-slot="approval-card"
        data-sent=""
        className={cn("flex w-full items-center gap-3 animate-in fade-in zoom-in-95", className)}
        {...props}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset py-1 pr-2.5 pl-1 text-body font-medium text-ink">
          <span className="flex size-4.5 items-center justify-center rounded-full bg-ink text-background">
            <CheckIcon size={11} strokeWidth={3} />
          </span>
          {sentLabel}
        </span>
      </div>
    );
  }

  return (
    <ApprovalCardContext value={value}>
      <div
        ref={ref}
        data-slot="approval-card"
        aria-busy={sending}
        className={cn(
          "w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </ApprovalCardContext>
  );
};

interface ApprovalQuestionProps extends HTMLAttributes<HTMLDivElement> {
  questionId: string;
  prompt: string;
  detail?: string;
}

const ApprovalQuestion = ({
  questionId,
  prompt,
  detail,
  className,
  children,
  ref,
  ...props
}: ApprovalQuestionProps & RefAttributes<HTMLDivElement>) => {
  const { answer, picked, register, submit } = useApprovalCard();
  useEffect(() => {
    register(questionId);
  }, [register, questionId]);

  const selected = picked[questionId] ?? noSelection;

  const pick = useCallback(
    (optionId: string): void => {
      const next = [optionId];
      answer(questionId, next);
      submit({ optionIds: next, questionId });
    },
    [answer, questionId, submit],
  );

  const context = useMemo(() => ({ pick, selected }), [pick, selected]);

  return (
    <ApprovalQuestionContext value={context}>
      <div
        ref={ref}
        data-slot="approval-question"
        className={cn("animate-in fade-in slide-in-from-bottom-1 p-3", className)}
        {...props}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-subtitle font-medium text-ink">{prompt}</span>
          {detail === undefined ? null : (
            <span className="text-body break-words text-ink-2">{detail}</span>
          )}
        </span>
        <div className="mt-2 flex flex-col gap-0.5">{children}</div>
      </div>
    </ApprovalQuestionContext>
  );
};

// onClick is omitted: a forwarded one would replace the pick while aria-pressed still promised it
interface ApprovalOptionProps extends Omit<HTMLAttributes<HTMLButtonElement>, "onClick"> {
  optionId: string;
}

const ApprovalOption = ({
  optionId,
  className,
  children,
  ref,
  ...props
}: ApprovalOptionProps & RefAttributes<HTMLButtonElement>) => {
  const { sending } = useApprovalCard();
  const { pick, selected } = useApprovalQuestion();
  const on = selected.includes(optionId);
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={on}
      disabled={sending}
      onClick={() => {
        pick(optionId);
      }}
      data-slot="approval-option"
      className={cn(
        "-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-100 hover:bg-hover",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
          on
            ? "bg-ink text-background"
            : "text-transparent shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full bg-background transition-transform duration-200",
            on ? "scale-100" : "scale-0",
          )}
        />
      </span>
      <span
        className={cn(
          "text-subtitle transition-colors duration-200",
          on ? "text-ink" : "text-ink-2",
        )}
      >
        {children}
      </span>
    </button>
  );
};

export { ApprovalCard, ApprovalQuestion, ApprovalOption };
