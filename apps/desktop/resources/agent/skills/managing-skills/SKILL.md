---
name: managing-skills
description: >
  Author and refine your own skills. Use when you've just worked out a
  non-trivial, repeatable procedure (a multi-step workflow, a fiddly tool
  recipe, a gotcha worth remembering) and want it available next time —
  or when the user asks you to "remember how to do X" or to update an
  existing skill.
---

# Managing your own skills

You can write skills. A skill is a Markdown file that gets loaded into your
context at the start of a session, so a good skill turns a hard-won procedure
into something you just *know* next time instead of re-deriving it.

You already have the tools to do this — `write`, `edit`, `read`, `bash`, `ls`.
No special tool is needed.

## Where skills live

User skills live under:

```
~/.inteligir/skills/<skill-name>/SKILL.md
```

List what already exists before adding more:

```bash
ls ~/.inteligir/skills/
```

## Format

Each skill is a directory containing a `SKILL.md` with YAML frontmatter and a
Markdown body:

```markdown
---
name: skill-name
description: >
  One or two sentences. Lead with WHEN to use this skill — the description is
  what you'll see later to decide whether to reach for it, so make the trigger
  obvious.
---

# Title

The actual procedure. Be concrete: exact commands, exact arg shapes, the
order of steps, and the gotchas that cost you time the first time.
```

- `name` must match the directory name and be kebab-case.
- `description` is the part that matters most — it's the only thing surfaced
  when deciding whether to load the skill, so write it for future-you.
- The body can include supporting files in the same directory (scripts,
  templates); reference them by relative path.

## When to write one

Write a skill after you complete something non-trivial and repeatable:

- A workflow that took several steps to get right.
- A tool invocation with non-obvious flags or argument shapes.
- A gotcha or failure mode and how you worked around it.

Don't skill-ify one-off tasks or anything that's already obvious from a tool's
`--help`.

## Refining a skill

Skills are meant to improve with use. When a skill steered you wrong or was
incomplete, `read` it and `edit` it — tighten the description, fix the steps,
add the gotcha you just hit.

## Important: when changes take effect

Skills are loaded at the **start of a session**. A skill you write or edit now
becomes active on the **next** session, not mid-conversation. So write the
skill when you finish the work; you'll have it the next time it's relevant.
