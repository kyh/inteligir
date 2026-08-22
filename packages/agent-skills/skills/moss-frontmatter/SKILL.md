---
name: moss-frontmatter
description: YAML frontmatter rules for Moss note metadata. Use when adding, preserving, or editing the optional metadata block at the top of a note.
---

# Moss Frontmatter

Frontmatter is an optional top-level YAML mapping before the note's H1.

```markdown
---
status: active
tags:
  - project
people:
  - jane
---

# Note Title
```

## Authoring Contract

- Use frontmatter for structured fields that help search, filtering, grouping, or retrieval.
- Prefer scalars and lists of strings. Moss parses nested arrays and objects but displays them read-only; preserve them unless the task explicitly requests a filesystem edit to that structure.
- `type` and `status` are workspace vocabularies, not fixed enums. Reuse values already present in the workspace when possible.
- Common fields are `type`, `people`, `description`, `tags`, and `status`; unknown fields are valid and must be preserved.
- For workspace notes under `~/Moss/Notes/`, preserve existing `created_date` and let Moss set it for new notes. Do not invent or overwrite it.
- The note title comes from the leading H1, not a `title` field.
- Do not duplicate metadata as body headings or bold labels.
- Omit frontmatter when the note has no useful metadata.

## Editing And Recovery

Filesystem writers may edit any field the task explicitly targets, including a nested value, while preserving unrelated keys. The Moss Properties UI edits supported scalar/list fields and treats nested values as read-only.

Keep YAML valid and retain the top-level mapping. If existing frontmatter is malformed, preserve it unless the user asks for repair; Moss retains malformed YAML but cannot edit it through Properties.

## Final Check

- Frontmatter is the first block and closes before the H1.
- YAML is a top-level mapping.
- Unknown and unrelated fields remain intact.
- Workspace-managed `created_date` was not invented or overwritten.
