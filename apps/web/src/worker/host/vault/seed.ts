// ---------------------------------------------------------------------------
// The vault a new account lands in.
//
// A cloud workspace has no folder to pick, so a fresh user's first screen is
// whatever this writes. Three files, each earning its place: a Welcome note
// that teaches the two things about this app nobody guesses (chat edits your
// files; a checkbox can be handed to a background agent), the standing-
// instructions file the agent reads every turn, and one template so the
// template command has something to apply.
//
// Every file is inside the editor's MDX vocabulary — no HTML comments, no
// unknown JSX — so all three open in Rich mode rather than Raw.
// ---------------------------------------------------------------------------

import {
  AGENT_INSTRUCTIONS_PATH,
  AGENT_INSTRUCTIONS_SKELETON,
} from "@repo/bridge/agent-instructions";

import type { UserVault } from "./user-vault";

const WELCOME = `# Welcome

This is your vault: a folder of markdown files you own. Notes are plain
markdown, so nothing here is locked up in a format only this app can read.

## Chat edits these files

The composer at the bottom is an agent with access to this vault. Ask it to
draft a note, reorganize a folder, or pull the open note apart into three — it
edits the files directly, and every change is undoable.

## Delegate a checkbox

Any task in a note can be handed off. Write one and delegate it:

- [ ] Ask the agent to summarize this note

A delegated task runs in the background, checks its own box when it finishes,
and writes the result underneath.

## Link notes together

Type \`[[\` to link to another note. Links are two-way — every note shows what
links back to it, so structure emerges from writing rather than from filing.

Start anywhere. Rename this note when it stops being useful.
`;

const MEETING_TEMPLATE = `# {{title}}

Date: {{date}}

## Attendees

## Notes

## Actions

- [ ]
`;

/**
 * The note a freshly seeded workspace lands on.
 *
 * A first screen that says "select a note to edit" in front of a vault the user
 * did not create is a puzzle, not an empty state — so the seed decides what is
 * open, the same way it decides what exists. The host writes it into ui-state
 * under `UI_STATE_OPEN_NOTE_KEY` and the workspace restores it on boot like any
 * other session.
 */
export const SEED_OPEN_NOTE = "Welcome.md";

/** The files a brand-new vault starts with, in the order they are written. */
const SEED_FILES: ReadonlyArray<{ readonly path: string; readonly content: string }> = [
  { path: SEED_OPEN_NOTE, content: WELCOME },
  { path: AGENT_INSTRUCTIONS_PATH, content: AGENT_INSTRUCTIONS_SKELETON },
  { path: "templates/Meeting notes.md", content: MEETING_TEMPLATE },
];

/**
 * Seed a vault that has never held a file. Returns whether anything was
 * written.
 *
 * Idempotent, and the precondition is deliberately "the manifest is EMPTY"
 * rather than "this file is absent": a tombstone counts, so a user who deletes
 * Welcome.md is never handed it back, and a per-file check would do exactly
 * that on the next sign-in. The only way to be re-seeded is to have nothing at
 * all — which is what a new vault is.
 */
export async function seedVault(vault: UserVault): Promise<boolean> {
  if (!vault.isEmpty()) return false;
  for (const file of SEED_FILES) await vault.writeText(file.path, file.content);
  return true;
}
