"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useState } from "react";

import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * APPROVAL CARD (human-in-the-loop)
 * One question at a time; elongated pills show progress;
 * the circular arrow up top advances (↑ sends on the last).
 *
 * Upstream's questions are a module fixture and the card owns
 * the answers. Here QUESTIONS ARE THE INPUT and `onSubmit`
 * hands the answers back — the caller owns what an answer
 * means, since ours settle a live turn rather than a demo.
 * ───────────────────────────────────────────────────────── */

export interface ApprovalOption {
  id: string;
  label: string;
}

export interface ApprovalQuestion {
  id: string;
  prompt: string;
  /** radio auto-advances on pick; check waits for the arrow. */
  kind: "radio" | "check";
  options: readonly ApprovalOption[];
  /** Offer the free-text row under the options. */
  allowCustom?: boolean;
}

/** Per question: the option ids picked, plus any typed text. */
export interface ApprovalAnswer {
  questionId: string;
  optionIds: string[];
  custom?: string;
}

export interface ApprovalCardProps {
  questions: readonly ApprovalQuestion[];
  onSubmit: (answers: ApprovalAnswer[]) => void;
  /** Absent hides the dismiss affordance — some approvals must be answered. */
  onDismiss?: () => void;
  /** Replaces the card once answered; the caller usually re-renders instead. */
  sentLabel?: string;
  className?: string;
}

export function ApprovalCard({
  questions,
  onSubmit,
  onDismiss,
  sentLabel = "Answers sent",
  className,
}: ApprovalCardProps) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const question = questions[index];
  if (question === undefined) return null;

  const last = index === questions.length - 1;
  const selected = picked[question.id] ?? [];
  const typed = custom[question.id] ?? "";
  const hasAnswer = selected.length > 0 || typed.trim().length > 0;

  const collect = (
    nextPicked: Record<string, string[]>,
    nextCustom: Record<string, string>,
  ): ApprovalAnswer[] =>
    questions.map((entry) => {
      const text = (nextCustom[entry.id] ?? "").trim();
      const answer: ApprovalAnswer = {
        questionId: entry.id,
        optionIds: nextPicked[entry.id] ?? [],
      };
      return text.length > 0 ? { ...answer, custom: text } : answer;
    });

  const submit = (
    nextPicked: Record<string, string[]>,
    nextCustom: Record<string, string>,
  ): void => {
    setSent(true);
    onSubmit(collect(nextPicked, nextCustom));
  };

  const toggle = (optionId: string): void => {
    const current = picked[question.id] ?? [];
    const next =
      question.kind === "radio"
        ? [optionId]
        : current.includes(optionId)
          ? current.filter((entry) => entry !== optionId)
          : [...current, optionId];
    const nextPicked = { ...picked, [question.id]: next };
    setPicked(nextPicked);
    if (question.kind !== "radio") return;
    // Single-choice commits itself: picking IS the answer, so the arrow would
    // be a second confirmation of a decision already made.
    const nextCustom = { ...custom, [question.id]: "" };
    setCustom(nextCustom);
    if (last) submit(nextPicked, nextCustom);
    else setIndex((value) => Math.min(questions.length - 1, value + 1));
  };

  if (sent) {
    return (
      <div
        className={cn("flex w-full items-center gap-3 animate-in fade-in zoom-in-95", className)}
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
    <div className={cn("flex w-full flex-col items-stretch", className)}>
      <div className="w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2">
        <div key={question.id} className="animate-in fade-in slide-in-from-bottom-1 p-3">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">{question.prompt}</span>
            {onDismiss !== undefined ? (
              <button
                type="button"
                aria-label="Dismiss"
                onClick={onDismiss}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                <svg
                  aria-hidden
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            ) : null}
          </div>

          <div className="mt-2 flex flex-col gap-0.5">
            {question.options.map((option) => {
              const on = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(option.id)}
                  className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-100 hover:bg-hover"
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center transition-colors duration-200",
                      question.kind === "radio" ? "rounded-full" : "rounded-[5px]",
                      on
                        ? "bg-ink text-background"
                        : "text-transparent shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
                    )}
                  >
                    {question.kind === "radio" ? (
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
                    {option.label}
                  </span>
                </button>
              );
            })}

            {question.allowCustom === true ? (
              <label className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-100 focus-within:bg-hover hover:bg-hover">
                <span aria-hidden className="size-4 shrink-0" />
                <input
                  value={typed}
                  onChange={(event) => {
                    setCustom({ ...custom, [question.id]: event.target.value });
                    if (question.kind === "radio") setPicked({ ...picked, [question.id]: [] });
                  }}
                  placeholder="Type something…"
                  aria-label="Custom answer"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
                />
              </label>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line px-3 py-2">
          {questions.length > 1 ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous"
                disabled={index === 0}
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
                className="flex size-6 items-center justify-center rounded-[5px] text-ink-3 transition-colors duration-100 enabled:hover:bg-hover enabled:hover:text-ink-2 disabled:opacity-35"
              >
                <svg
                  aria-hidden
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <span className="flex items-center gap-1">
                {questions.map((entry, dot) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-label={`Go to question ${String(dot + 1)}`}
                    aria-current={dot === index ? "step" : undefined}
                    onClick={() => setIndex(dot)}
                    className="rounded-full transition-[width,height,background-color,border-color,border-width] duration-300"
                    style={
                      dot === index
                        ? { width: 9, height: 9, border: "2.5px solid var(--ink)" }
                        : dot < index
                          ? { width: 7, height: 7, background: "var(--ink-3)" }
                          : { width: 7, height: 7, border: "1.5px solid var(--ink-3)" }
                    }
                  />
                ))}
              </span>
              <button
                type="button"
                aria-label="Next"
                disabled={last}
                onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}
                className="flex size-6 items-center justify-center rounded-[5px] text-ink-3 transition-colors duration-100 enabled:hover:bg-hover enabled:hover:text-ink-2 disabled:opacity-35"
              >
                <svg
                  aria-hidden
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </span>
          ) : (
            <span />
          )}

          <button
            type="button"
            aria-label={last ? "Send answers" : "Next question"}
            disabled={!hasAnswer}
            onClick={() => {
              if (last) submit(picked, custom);
              else setIndex((value) => value + 1);
            }}
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
      </div>
    </div>
  );
}
