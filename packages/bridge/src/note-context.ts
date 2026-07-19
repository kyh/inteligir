// ---------------------------------------------------------------------------
// The auto-attached note-context turn prefix — ONE format definition shared
// by the desktop renderer (builds + strips it) and the mobile chat surface
// (strips it from rehydrated history). The prefix rides only the text sent to
// the agent; displayed bubbles never carry it.
// ---------------------------------------------------------------------------

/** Prefix a fresh user turn with the open note so the single persistent
 * thread is note-aware without the user naming the file. */
export function buildNoteContext(text: string, activeNote: string | undefined): string {
  // Ground the agent in the real date — it otherwise hallucinates one — and, if
  // a note is open, in which file "this note" refers to.
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const note =
    activeNote === undefined
      ? ""
      : ` The note open in front of me is ./vault/${activeNote}; if I say "this note", "here", or don't name a file, I mean that one.`;
  return `[Context: today is ${today}.${note}]\n\n${text}`;
}

// Lazy up to the first `]` that closes the block (`]\n\n`), so a `]` inside a
// note path doesn't truncate the strip and leak context into the bubble.
const NOTE_CONTEXT_RE = /^\[Context: [\s\S]*?\]\n\n/;

/** Remove the auto-attached note context so rehydrated history shows the
 * user's actual words (the agent's stored message includes the prefix; the
 * live optimistic bubble never did). */
export function stripNoteContext(text: string): string {
  return text.replace(NOTE_CONTEXT_RE, "");
}
