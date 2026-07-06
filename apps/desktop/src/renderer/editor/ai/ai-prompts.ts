// AI menu prompt data + builders — the pure, editor-agnostic half of the AI
// session. No Plate/editor state here: canned actions, translate targets, and
// the functions that turn an (action, request, context) into the exact prompt
// string the host runs. Kept separate from the run/token state machine in
// ai-session.ts so each file reads as one concern.

export type CannedActionId =
  | "continue"
  | "summarize"
  | "explain"
  | "improve"
  | "longer"
  | "shorter"
  | "grammar"
  | "simplify";

export type CannedAction = {
  id: CannedActionId;
  label: string;
  intent: "generate" | "edit";
  /** Which command set offers the action (potion's split): `cursor` when the
   * captured selection is collapsed, `selection` when text is selected. */
  scope: "cursor" | "selection";
  keywords: string[];
};

export const CANNED_ACTIONS: CannedAction[] = [
  {
    id: "continue",
    label: "Continue writing",
    intent: "generate",
    scope: "cursor",
    keywords: ["write", "more"],
  },
  {
    id: "summarize",
    label: "Summarize",
    intent: "generate",
    scope: "cursor",
    keywords: ["tldr", "summary"],
  },
  {
    id: "explain",
    label: "Explain",
    intent: "generate",
    scope: "cursor",
    keywords: ["what", "meaning"],
  },
  {
    id: "improve",
    label: "Improve writing",
    intent: "edit",
    scope: "selection",
    keywords: ["rewrite", "better"],
  },
  {
    id: "longer",
    label: "Make longer",
    intent: "edit",
    scope: "selection",
    keywords: ["expand", "elaborate"],
  },
  {
    id: "shorter",
    label: "Make shorter",
    intent: "edit",
    scope: "selection",
    keywords: ["concise", "shorten"],
  },
  {
    id: "grammar",
    label: "Fix spelling & grammar",
    intent: "edit",
    scope: "selection",
    keywords: ["spelling", "typo"],
  },
  {
    id: "simplify",
    label: "Simplify language",
    intent: "edit",
    scope: "selection",
    keywords: ["plain", "simple"],
  },
];

/** Translate targets offered on the AI menu's language page — a pragmatic
 * subset (free-form prompts cover the rest). */
export const TRANSLATE_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Japanese",
  "Korean",
  "Chinese (Simplified)",
] as const;

const PROMPT_BASE =
  "You are a writing assistant inside a notes editor. Respond with ONLY the resulting text — no preamble, no surrounding quotes, no markdown code fences, no explanation.";

export function generatePromptFor(
  action: CannedActionId | null,
  request: string,
  context: string,
): string {
  switch (action) {
    case "continue":
      return `${PROMPT_BASE}\n\nContinue the following text naturally with one short paragraph:\n\n${context}`;
    case "summarize":
      return `${PROMPT_BASE}\n\nWrite a concise summary of the following:\n\n${context}`;
    case "explain":
      return `${PROMPT_BASE}\n\nExplain the following in one short, plain-language paragraph:\n\n${context}`;
    default:
      return `${PROMPT_BASE}\n\nContext:\n\n${context}\n\nRequest: ${request}`;
  }
}

export function editInstructionFor(action: CannedActionId | null, request: string): string {
  switch (action) {
    case "improve":
      return "Improve the writing for clarity and flow, keeping the meaning and the markdown structure.";
    case "longer":
      return "Make the content longer by elaborating on the existing ideas, without changing meaning or adding new information. Keep the markdown structure.";
    case "shorter":
      return "Make the content more concise, keeping the meaning and the markdown structure.";
    case "grammar":
      return "Fix spelling, grammar, and punctuation only. Do not change meaning, tone, or structure.";
    case "simplify":
      return "Simplify the language using clearer, more straightforward wording, without changing meaning. Keep the markdown structure.";
    default:
      return request;
  }
}

// The <markdown> sentinel is load-bearing: the host passes the prompt through
// verbatim, and the dev-harness fixture parses the block back out to fake an
// edit. Keep in sync with fixture-bridge.ts.
export function buildEditPrompt(instruction: string, markdown: string): string {
  return [
    "You are a writing assistant inside a notes editor. Apply the instruction to the markdown document below.",
    "Respond with ONLY the full rewritten markdown — same dialect (GitHub-flavored), no code fences around the whole answer, no commentary.",
    "",
    `<instruction>\n${instruction}\n</instruction>`,
    `<markdown>\n${markdown}\n</markdown>`,
  ].join("\n");
}
