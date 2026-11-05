# @repo/agent-skills

The built-in agent's system prompt, as the files it is built from: `built-in-agent.md`, the
agent's own instructions (who it works for, the library's tools it calls, what it must not
trust), and nine `SKILL.md` documents — one hub and eight focused contracts — that state exactly
which markdown the library reads and writes, so what the agent writes is what the app keeps. No
code, no scripts, no build; the package is markdown and an `exports` map.

## Why it exists

The agent reads and edits the library only through the library's own procedures, the tools the
connector serves (`read_item` answers an item's text in this dialect, `edit_item` and
`create_note` take it back), and the dialect — `[[Title|id]]` links, `{{formula}}` pills,
`%%i:id%%` highlight markers, the `inteligir-*` fences, the `:::article` section — is not
something a model guesses right. The agent has no shell and no files, so nothing here is read at
run time: every word is inlined into the system prompt, in a fixed order, the same bytes for every
conversation of every account, so all of them read one cached prefix. Each conversation freezes the
prompt at its first turn, and a deploy that changes it, as an edit here does, is taken up at the
start of the conversation's next turn, never mid-turn (`apps/web/src/worker/agent/thread-loop.ts`).

## Layout

```
built-in-agent.md                 # THE AGENT'S OWN INSTRUCTIONS: its tools, a turn, what it
                                  # must not trust, the view context a message carries
skills/
  inteligir-notes/SKILL.md        # THE HUB: the rules that never bend, how an item reads, the
                                  # block chooser, document syntax, and the index of the
                                  # focused contracts below, in the order the prompt holds them
  inteligir-items/SKILL.md        # a library's items: kinds and fields, Unsorted, folders and
                                  # tags, saving, finding, filing and tagging one
  inteligir-writing/SKILL.md      # how a note should READ — answer first, shape fits the
                                  # information, when to stop
  inteligir-fields/SKILL.md       # an item's fields: which the agent changes, with which
                                  # call, and which are the library's
  inteligir-links/SKILL.md        # [[Title|id]] / #heading / |alias, external links,
                                  # embeds and the library's files
  inteligir-formulas/SKILL.md     # {{source|display|meta}} pills and named variables:
                                  # grammar, identity, references
  inteligir-annotations/SKILL.md  # highlights: add_highlight, the %%i:id:start/end%%
                                  # markers, notes, attribution
  inteligir-canvas/SKILL.md       # inteligir-canvas fences: when a sketch is the answer, and
                                  # the exact grid payload
  inteligir-html/SKILL.md         # inteligir-html fences: the shell, the sandbox contract,
                                  # the one fixed palette
```

Each `SKILL.md` opens with frontmatter — `name` (the directory) and a one-line `description` —
then the contract, and ends with a "Before You Finish" checklist the agent runs against its own
edit. The frontmatter is the file's own; the prompt carries the body alone.

## How it reaches the agent

`apps/web/scripts/agent-prompt.ts` (`pnpm --filter @repo/web agent-prompt`) builds the prompt from
this package — `built-in-agent.md`, the hub, then every focused contract in the hub's order — and
writes it as the Worker's module `apps/web/src/worker/agent/agent-prompt.ts`, which every new
conversation sends as its system. The prompt is code the Worker ships, so a PR's skills are the ones
its preview runs. Edit a file here, run the script, and commit what it writes.

## Invariants

- **Files, never imports.** Nothing imports this package's files as modules; the script reads them
  through the `exports` map, and `apps/web` declares the dependency so a change here marks the
  Worker changed.
- **Written for the library's tools alone.** The agent has no shell, no files and no web: a skill
  names a tool, never a command, a path on disk or a CLI verb.
- **The spec is the parser's.** A construct a skill teaches is one the editor round-trips; every
  fence's one spelling is `@repo/notes/markdown/fence-langs`, and a skill that disagrees with it
  teaches the agent to write bytes a save rewrites.
- **Nothing of an account or a request.** The prompt is the same bytes for every person and every
  turn; what a turn needs rides its messages: the view context the person's message, and the
  filing rules a system message after it.
- **Adding a skill** is one directory, one `SKILL.md`, frontmatter `name` equal to the directory,
  and a row under the hub's "Focused Contracts", which places it in the prompt. A new construct
  lands in the editor kit, the rule table and `fence-langs` FIRST, then the words.
- The files are ordinary tracked markdown: oxfmt formats them, and the dangling-reference guard
  sweeps them like any other `.md`.

## Testing

No suite of its own — `package.json` has no scripts. `tools/repo-guards/src/agent-skills.test.ts`
pins the set (every directory's `SKILL.md` names it, the hub names every focused skill and no
phantom), holds every `inteligir-*` fence an example opens to `@repo/notes/markdown/fence-langs`,
runs the script's `--check` against the committed module, which the script holds under 100,000
characters, about 25,000 tokens: a prompt longer than that is one no turn should pay to cache. `packages/editor/src/skill-examples.test.ts` opens each
example through the editor.
