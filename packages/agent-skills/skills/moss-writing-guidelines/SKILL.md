---
name: moss-writing-guidelines
description: Writing and scannability guidelines for Moss notes. Use when creating, editing, restructuring, or reviewing a note for reader-first structure, composition, scannability, or writing quality.
---

# Moss Writing Guidelines

Write for a reader who skims first and reads second. This skill owns note structure and composition; `moss-notes` owns file layout, node selection, and persisted syntax.

## Lead With The Answer

Frontmatter and the single H1 title come first when present. The first body paragraph after the H1 should state the answer, decision, status, or takeaway without requiring background from later sections.

- Put conclusions before evidence and caveats.
- Order sections from most to least important.
- Keep paragraphs short, usually two to four sentences.
- Use H2 for major sections and H3/H4 for subsections; never add a second H1.
- Keep useful detail, but move derivations and side material later instead of front-loading it.

## Compose For The Information Shape

Choose nodes with the canonical routing table in `moss-notes`, then compose them so each fact has one clear home.

| Information shape                              | Composition                     |
| ---------------------------------------------- | ------------------------------- |
| One connective idea                            | A short paragraph               |
| Several related points or steps                | Bullets or a numbered list      |
| Repeated attributes that must be compared      | A compact table                 |
| Two to four peer views inspected one at a time | Tabs                            |
| High-signal context, warning, or priority      | A callout                       |
| A numerical pattern or trend                   | A chart                         |
| A question or decision requiring attention     | A comment on the exact evidence |

- Use tabs as an outer container when peer views share one context. A tab may contain normal Moss content.
- Use tables only for content that fits Moss's one-line cell syntax. Move lists, callouts, and other block nodes outside the table.
- Keep requirements and review questions in native Markdown and comments. Use HTML only for the interactive artifact itself.
- Use comments for explicit questions, decisions, approvals, or review points that need attention. Fix ordinary wording, duplication, and scannability issues directly.
- When two structures fit equally, choose the one that reads faster.

## Common Note Shapes

- **Decision or proposal:** recommendation -> options -> tradeoffs -> next steps.
- **Plan:** goal -> checklist or steps -> owners/status -> open questions.
- **Research:** findings -> supporting evidence by theme -> sources.
- **Reference:** one-line definition -> rules or steps -> examples.
- **Status:** headline state -> what changed -> what happens next.

For specifications and feature notes, place the problem and recommendation near the first relevant visual. Keep each requirement in one canonical section; use summaries and links instead of repeating the full requirement across tables, tabs, mockups, and checklists.

## Final Review

Confirm that:

- frontmatter and one H1 precede a standalone takeaway paragraph;
- headings plus their opening lines tell the story to a skimmer;
- sections run from most to least important;
- each node matches the routing rules in `moss-notes`;
- tables contain only supported inline cell content;
- comments mark real review attention rather than editorial cleanup;
- metadata stays in frontmatter instead of being duplicated in the body;
- every fact has one canonical home.
