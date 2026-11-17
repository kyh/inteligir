// What an undo's answer says, in one sentence for both of the agent panel's Undo buttons.

import { toast } from "@repo/ui/components/sonner";

interface UndoAnswer {
  readonly kept: readonly string[];
  readonly refused: readonly string[];
  readonly reverted: readonly string[];
}

// another device, or a press before this one, already took it all back
const NOTHING_LEFT = "There's nothing left to undo.";
const NOTHING_UNDONE =
  "Nothing was undone. Changes made since were kept where they overlapped, so you can undo this again.";

// what it took back, what a later change kept as it is, and what a rule held back, which Undo can
// still take
export const undoSentence = (answer: UndoAnswer) => {
  if (answer.refused.length > 0) {
    return "Partly undone. Some items couldn't come back yet, so you can undo this again.";
  }
  if (answer.kept.length === 0) {
    return answer.reverted.length === 0 ? NOTHING_LEFT : "Undone.";
  }
  return answer.reverted.length === 0
    ? NOTHING_UNDONE
    : "Undone, but changes made since were kept where they overlapped.";
};

// an undo that took nothing back is no success
export const announceUndo = (answer: UndoAnswer): void => {
  const sentence = undoSentence(answer);
  if (sentence === NOTHING_UNDONE || sentence === NOTHING_LEFT) {
    toast.info(sentence);
  } else {
    toast.success(sentence);
  }
};
