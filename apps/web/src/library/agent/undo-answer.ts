// What an undo's answer says, in one sentence for both of the agent panel's Undo buttons, and one
// more naming each note whose typing went with the agent's words.

import { toast } from "@repo/ui/components/sonner";

interface UndoAnswer {
  readonly kept: readonly string[];
  readonly lostText: readonly string[];
  readonly refused: readonly string[];
  readonly reverted: readonly string[];
}

const NOTHING_UNDONE =
  "Nothing was undone. Changes made since were kept where they overlapped, so you can undo this again.";

// past this many, the notes are counted rather than named
const NAMED_MAX = 3;

// what it took back, what a later change kept as it is, and what a rule held back, which Undo can
// still take
export const undoSentence = (answer: Omit<UndoAnswer, "lostText">) => {
  if (answer.refused.length > 0) {
    return "Partly undone. Some items couldn't come back yet, so you can undo this again.";
  }
  if (answer.kept.length === 0) {
    return "Undone.";
  }
  return answer.reverted.length === 0
    ? NOTHING_UNDONE
    : "Undone, but changes made since were kept where they overlapped.";
};

// the notes where someone typed inside what the agent wrote, which the undo took with it
export const lostTextSentence = (titles: readonly string[]): string | null => {
  if (titles.length === 0) {
    return null;
  }
  const quoted = titles.map((title) => `“${title}”`);
  const where =
    quoted.length > NAMED_MAX
      ? `${String(quoted.length)} notes`
      : new Intl.ListFormat("en", { type: "conjunction" }).format(quoted);
  return `What was typed inside the agent's words in ${where} went with them.`;
};

// an undo that took nothing back is no success, and one that took typing with it says where
export const announceUndo = (answer: UndoAnswer, titleOf: (itemId: string) => string): void => {
  const sentence = undoSentence(answer);
  const lost = lostTextSentence(answer.lostText.map(titleOf));
  if (lost !== null) {
    toast.warning(sentence, { description: lost });
  } else if (sentence === NOTHING_UNDONE) {
    toast.info(sentence);
  } else {
    toast.success(sentence);
  }
};
