# @repo/agent-skills

The inteligir dialect's spec, served to agents as files: eight `SKILL.md`
documents — one hub and seven focused contracts — that tell a coding agent
exactly which bytes the editor round-trips, so what it writes is what the app
parses. No code, no scripts, no build; the package is a directory of markdown
and an `exports` map.

## Why it exists

The agent edits the vault with its own shell, and the dialect — `[[wiki
links]]`, `{{formula}}` pills, `%%i:id%%` comment anchors, the `inteligir-*`
fences — is not something a model guesses right. Content the agent consumes
lives in files it reads with its own tools, never inlined into a prompt (the
rule behind CLAUDE.md's "agent memory is removed" decision): the server hands a
session ONE path, `INTELIGIR_SKILLS_DIR`, plus a three-sentence pointer on the
first turn, and the model reads what it needs. A package rather than a folder
under `apps/cli` because the CLI's build and the packaged desktop app both stage
it, and the dep-dag names it as an ARTIFACT edge — installed and copied, never
imported (`DECLARED_ARTIFACT_EDGES` in `tools/repo-guards/src/dep-dag.test.ts`).

## Layout

```
skills/
  inteligir-notes/SKILL.md        # THE HUB: the rules that never bend, the block
                                  # chooser, document syntax, and the index of
                                  # the focused contracts below
  inteligir-writing/SKILL.md      # how a note should READ — answer first, shape
                                  # fits the information, when to stop
  inteligir-frontmatter/SKILL.md  # YAML frontmatter as the only property store;
                                  # what belongs, what is never invented
  inteligir-links/SKILL.md        # [[Title]] / #heading / |alias / |uuid,
                                  # external links, embeds and vault media
  inteligir-formulas/SKILL.md     # {{source|display|meta}} pills and named
                                  # variables: grammar, identity, references
  inteligir-comments/SKILL.md     # %%i:id:start/end%% markers, the
                                  # .inteligir/comments store, attribution
  inteligir-canvas/SKILL.md       # inteligir-canvas fences: when a sketch is the
                                  # answer, and the exact grid payload
  inteligir-html/SKILL.md         # inteligir-html fences: the shell, the sandbox
                                  # contract, the one fixed palette
```

Each `SKILL.md` opens with frontmatter — `name` (the directory) and a one-line
`description` — then the contract, and ends with a "Before You Finish" checklist
the agent runs against its own edit.

## How a skill reaches an agent

- **In a checkout**, `resolveSkillsDir`
  (`apps/cli/src/server/agents/agent-shell-env.ts`) resolves
  `@repo/agent-skills/skills/inteligir-notes/SKILL.md` through this package's
  `exports` map with `createRequire` and takes `skills/` two levels up. The map
  exists FOR that resolve, and `inteligir-notes` is the probe file: renaming it
  silently drops the pointer in every checkout.
- **In a published install** no workspace package resolves, so the same
  function reads `dist/skills` — `apps/cli/scripts/build.mjs` copies this
  directory there as CONTENT beside the migrations, the licences and the UI.
- The path resolves ONCE at boot, in `apps/cli/src/server/serve.ts`'s driver
  factory, and rides `AgentSessionFacts`. `toShellEnv` names it
  `INTELIGIR_SKILLS_DIR` in the agent's shell and `toInstructions` states the
  pointer at the head of the first turn's prompt (ACP's `session/new` carries no
  instructions field) — each only when the dir resolved, so a prompt never
  promises a path the shell does not carry.

## Invariants

- **Files, never imports.** Nothing under any `src/` imports this package; the
  dep-dag row is an artifact edge, so a module import fails as undeclared.
- **The spec is the parser's.** A construct a skill teaches is one the editor
  round-trips and the knowledge scan indexes; every fence's one spelling is
  `@repo/notes/markdown/fence-langs`, and a skill that disagrees with it teaches
  the agent to write bytes the app opens raw.
- **The pointer never inlines the spec** — three sentences, a path, and "read
  `inteligir-notes` first".
- **Adding a skill** is one directory, one `SKILL.md`, frontmatter `name` equal
  to the directory, and a row under the hub's "Focused Contracts" so the hub
  names it; `build.mjs` stages the whole directory, so nothing else changes. A
  new construct lands in the editor kit, the rule table, the scan and
  `fence-langs` FIRST, then the words.
- The skills are ordinary tracked markdown: oxfmt formats them, and the
  dangling-reference guard sweeps them like any other `.md`.

## Testing

No suite of its own — `package.json` has no scripts. The set itself is pinned
by `tools/repo-guards/src/agent-skills.test.ts`: every directory carries a
`SKILL.md` whose frontmatter names it, the hub's index names every focused
skill and no phantom, and the resolver's probe file exists, so renaming
`inteligir-notes` fails CI rather than silently dropping the pointer. The
rest of the pins are downstream:
`apps/cli/src/server/agents/__tests__/agent-shell-env.test.ts` and
`agent-instructions.test.ts` (the env var and the pointer appear together, and
only when a dir resolved), `acp-manager.test.ts` (the pointer leads the first
prompt), and both smokes — `pnpm smoke:cli` and `pnpm smoke:desktop` — which
fail a packaged install carrying no `dist/skills/inteligir-notes/SKILL.md`,
because a missing directory silently disables the capability rather than
erroring.
