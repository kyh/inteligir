# @repo/agent-skills

The inteligir dialect's spec, served to agents as files: nine `SKILL.md`
documents — one hub and eight focused contracts — that tell a coding agent
exactly which bytes the editor round-trips, so what it writes is what the app
parses. No code, no scripts, no build; the package is a directory of markdown
and an `exports` map.

## Why it exists

The agent edits the vault with its own shell, and the dialect — `[[wiki
links]]`, `{{formula}}` pills, `%%i:id%%` annotation markers, the `inteligir-*`
fences — is not something a model guesses right. Content the agent consumes
lives in files it reads with its own tools, never inlined into a prompt (the
rule behind the "agent memory is removed" decision in
`apps/cli/src/server/agents/CLAUDE.md`): the server hands a
session ONE path, `INTELIGIR_SKILLS_DIR`, plus a three-sentence pointer on the
first turn, and the model reads what it needs. A package rather than a folder
under `apps/cli` because the CLI's build and the packaged desktop app both stage
it: installed and copied, never imported. The CLI's manifest lists it because
`apps/cli/src/server/agents/agent-shell-env.ts` resolves its `skills/`
directory with `require.resolve`, which is also how knip counts the dependency
used.

## Layout

```
skills/
  inteligir-notes/SKILL.md        # THE HUB: the rules that never bend, the block
                                  # chooser, document syntax, and the index of
                                  # the focused contracts below
  inteligir-items/SKILL.md        # a library's items: kinds and keys, the cover
                                  # and the wrapper, Unsorted, folders and tags,
                                  # saving, filing and tagging one
  inteligir-writing/SKILL.md      # how a note should READ — answer first, shape
                                  # fits the information, when to stop
  inteligir-frontmatter/SKILL.md  # YAML frontmatter as the only property store;
                                  # what belongs, what is never invented
  inteligir-links/SKILL.md        # [[Title]] / #heading / |alias / |uuid,
                                  # external links, embeds and vault media
  inteligir-formulas/SKILL.md     # {{source|display|meta}} pills and named
                                  # variables: grammar, identity, references
  inteligir-annotations/SKILL.md  # %%i:id:start/end%% markers, the
                                  # .inteligir/annotations store, attribution
  inteligir-canvas/SKILL.md       # inteligir-canvas fences: when a sketch is the
                                  # answer, and the exact grid payload
  inteligir-html/SKILL.md         # inteligir-html fences: the shell, the sandbox
                                  # contract, the one fixed palette
```

Each `SKILL.md` opens with frontmatter — `name` (the directory) and a one-line
`description` — then the contract, and ends with a "Before You Finish" checklist
the agent runs against its own edit.

## How a skill reaches an agent

`resolveSkillsDir` (`apps/cli/src/server/agents/agent-shell-env.ts`) finds
`skills/` through this package's `exports` map in a checkout, and `dist/skills`
in a published install, where `apps/cli/scripts/build.ts` stages this
directory as content. `inteligir-notes/SKILL.md` is the file it resolves, so
renaming that skill would silently drop the pointer in every checkout; the
guard below fails first.

## Invariants

- **Files, never imports.** Nothing under any `src/` imports this package; no
  `DECLARED_EDGES` row in `tools/repo-guards/src/dep-dag.test.ts` names it, so
  a module import fails as undeclared.
- **The spec is the parser's.** A construct a skill teaches is one the editor
  round-trips and the knowledge scan indexes; every fence's one spelling is
  `@repo/notes/markdown/fence-langs`, and a skill that disagrees with it teaches
  the agent to write bytes the app opens raw.
- **The pointer never inlines the spec** — three sentences, a path, and "read
  `inteligir-notes` first".
- **Adding a skill** is one directory, one `SKILL.md`, frontmatter `name` equal
  to the directory, and a row under the hub's "Focused Contracts" so the hub
  names it; `build.ts` stages the whole directory, so nothing else changes. A
  new construct lands in the editor kit, the rule table, the scan and
  `fence-langs` FIRST, then the words.
- The skills are ordinary tracked markdown: oxfmt formats them, and the
  dangling-reference guard sweeps them like any other `.md`.

## Testing

No suite of its own — `package.json` has no scripts.
`tools/repo-guards/src/agent-skills.test.ts` pins the set (every directory's
`SKILL.md` names it, the hub names every focused skill and no phantom, the
resolver's probe file exists) and holds every `inteligir-*` fence an example
opens to `@repo/notes/markdown/fence-langs`, and
`packages/editor/src/skill-examples.test.ts` opens each example
through the editor. Both smokes fail a packaged install carrying no
`dist/skills/inteligir-notes/SKILL.md`, because a missing directory silently
disables the capability rather than erroring.
