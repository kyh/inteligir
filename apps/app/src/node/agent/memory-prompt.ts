// The per-turn memory index, as the model reads it. Composed here, beside the
// view-context block, because `input` is the ONLY per-turn channel codex
// honours (the view-context decision states why: instructions are per-session,
// the shell env is per-session) — and memory the agent wrote this turn must be
// visible the next, so it is DERIVED FRESH from the files each turn and never
// persisted.
//
// This is the COMPACT index — name + description per fact, grouped by type —
// not the bodies: full text is a `cat` away in the shell, and the index is a
// recurring per-turn prompt cost, so it is head-capped against its own small
// budget the same way the view-context excerpt is. When memory is empty the
// reader returns undefined and no element is added, which is what keeps a turn
// with no memory byte-identical to today's provider input.

import { MEMORY_TYPES, type MemoryEntry, type MemoryType } from "@repo/server-contract/memory";
import { readMemoryFacts } from "../memory/memory-store";
import { headCapUtf8 } from "./agent-instructions";

/** The byte budget for the index lines (the variable part). Small on purpose:
 *  this rides every turn, and the bodies are not here. */
export const MEMORY_INDEX_MAX_BYTES = 4_096;

const TYPE_HEADINGS = {
  user: "Who they are",
  preference: "How they want you to work",
} satisfies Record<MemoryType, string>;

const MEMORY_PREAMBLE =
  "Your memory of this user, kept as files in $INTELIGIR_MEMORY_DIR (read one for its full text; write or delete files there to update what you remember):";

function factLine(fact: MemoryEntry): string {
  return fact.description.length === 0 ? `- ${fact.name}` : `- ${fact.name} — ${fact.description}`;
}

/**
 * The block from a set of facts. Grouped by the closed type vocabulary in its
 * declared order; the index lines are capped (on a code-point boundary) while
 * the preamble is left whole, so the cut never eats the sentence that tells the
 * model what it is reading.
 */
export function composeMemoryBlock(facts: readonly MemoryEntry[]): string {
  const sections = MEMORY_TYPES.flatMap((type) => {
    const lines = facts.filter((fact) => fact.type === type).map(factLine);
    return lines.length === 0 ? [] : [`${TYPE_HEADINGS[type]}:\n${lines.join("\n")}`];
  });
  const index = headCapUtf8(sections.join("\n\n"), MEMORY_INDEX_MAX_BYTES);
  return `${MEMORY_PREAMBLE}\n\n${index}`;
}

/** The per-turn read the drivers call: the composed block, or undefined when
 *  there is nothing to inject. Globs the directory fresh every turn. */
export function readMemoryPromptBlock(memoryDir: string): string | undefined {
  const facts = readMemoryFacts(memoryDir);
  return facts.length === 0 ? undefined : composeMemoryBlock(facts);
}
