import { APICallError, generateText, Output } from "ai";
import { z } from "zod";

import { gatewayReachable } from "../agent/availability";

const FILER_MODEL = "anthropic/claude-haiku-5.5";

const TEXT_MAX = 6000;

export interface FilingAsk {
  readonly title: string;
  readonly url: string | null;
  readonly text: string;
  readonly folders: readonly string[];
  readonly tags: readonly string[];
  readonly rules: string | null;
}

const answerSchema = z.object({
  folder: z.string().nullable(),
  summary: z.string(),
  tags: z.array(z.string()),
});

const listed = (heading: string, lines: readonly string[]) =>
  lines.length === 0
    ? `${heading}: none`
    : `${heading}:\n${lines.map((line) => `- ${line}`).join("\n")}`;

const promptOf = (ask: FilingAsk) =>
  [
    "Someone just saved this to their personal library. Write a summary of it and suggest where it belongs.",
    "summary: two or three plain sentences saying what it is and why someone would keep it, in the item's own language, with no preamble.",
    "folder: exactly one of the folders listed below where it clearly belongs, or null when none clearly fits. Never invent one.",
    "tags: up to three of the tags listed below that clearly apply, or none. Never invent one.",
    ask.rules === null
      ? ""
      : `The person's own filing rules, which win over your judgement:\n${ask.rules}`,
    listed("Folders", ask.folders),
    listed("Tags", ask.tags),
    `Title: ${ask.title}`,
    ask.url === null ? "" : `Address: ${ask.url}`,
    `Text:\n${ask.text.slice(0, TEXT_MAX)}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");

export type FilingAnswer = z.infer<typeof answerSchema>;

export const askFiling = async (ask: FilingAsk) => {
  if (!gatewayReachable()) {
    return null;
  }

  try {
    const { output } = await generateText({
      maxOutputTokens: 600,
      maxRetries: 1,
      model: FILER_MODEL,
      output: Output.object({ schema: answerSchema }),
      prompt: promptOf(ask),
    });

    return output satisfies FilingAnswer | null;
  } catch (error) {
    if (APICallError.isInstance(error) && error.isRetryable) {
      throw error;
    }

    console.warn({ error: String(error), event: "filing-unanswered" });

    return null;
  }
};
