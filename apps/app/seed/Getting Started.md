---
id: a618c388-0d20-4ebe-bcbd-55b9d59094ec
description: A tour of inteligir, written in the constructs it is describing.
tags:
  - guide
status: reference
---

# Getting Started

inteligir is a notes app with an agent living inside it. Your notes are plain markdown files in a git repository you own, and everything below is a construct you can use in your own writing — this note is written in them.

Read [[Use Cases|f2745aa0-f394-4469-963d-438f2dd9fd5a]] when you want workflows rather than mechanics, and [[Kitchen Sink]] when you want every block in one screen.

## Your Vault Is Just Files

```plaintext
vault/
  Getting Started.md
  Getting Started.md.comments.json   # only when a note has comments
  Projects/Roadmap.md                # folders nest freely
  assets/diagram.png
  Trash/                             # deleted notes wait here
```

The filename is the title. There is no database, no proprietary container, and no lock-in: edit a note here, in vim, or from a script, and every tool sees the same bytes. The vault is a git repository, so your history is real history.

```inteligir-callout
info
Because the vault is git, "undo" survives quitting the app. Deleting a note moves it to `Trash/` first, and it stays restorable there.
```

## Writing

Select text for the formatting toolbar, or type `/` for the block menu.

- **Bold**, _italic_, ~~strikethrough~~, `inline code`
- <mark data-color="yellow">Highlight</mark> and <u>underline</u>
- Headings with `##`, quotes with `>`

Lists and checklists carry the work:

- [x] Open a note
- [ ] Leave a comment on a sentence
- [ ] Ask the agent something with `⌘K`

> A blockquote sets apart a decision or an excerpt worth its own line.

### Tables

| Use a table when          | Instead of                                 |
| ------------------------- | ------------------------------------------ |
| Values repeat across rows | Bullets that restate the same shape        |
| The reader compares       | Prose the reader has to hold in their head |

Cells hold inline content — links, pills, code — but not lists or fenced blocks.

### Callouts

Three kinds, and `priority` carries a level:

```inteligir-callout
warning
A warning callout marks something that will bite if ignored.
```

```inteligir-callout
priority
high
A priority callout states how urgent it is on its own line.
```

## Linking Notes Together

Type `[[` to link a note. Links survive renames, and a link to a note that does not exist yet renders dashed and offers to create it.

- [[Kitchen Sink]] — a plain link
- [[Use Cases|the workflows note]] — a link with its own words
- [[#Writing]] — a jump inside this note
- [[Field Notes]] — dashed, because that note is not written yet

Under **Related** in the right panel you get both halves of the graph: notes that link here, counted, and notes the app thinks are related, each with the reason it thinks so. Outgoing links are already on screen in your text, so they are deliberately not repeated there.

## Blocks Worth Knowing

### Charts

```inteligir-chart
{"type":"line","title":"Notes written","series":[{"name":"This month","data":[{"label":"Week 1","value":8},{"label":"Week 2","value":14},{"label":"Week 3","value":11},{"label":"Week 4","value":19}]}]}
```

Select a chart to edit its numbers in a grid, or open the raw JSON when you want to paste a whole series at once.

### Tabs

:::tabs
=== Before
The old approach, kept for comparison.

=== After
The current approach, with the reasoning that replaced it.
:::

### Formulas

A pill computes inline: {{2+2|4}}. Give one a name and other pills can build on it — change the anchor and everything derived from it moves:

{{28|28|id=21acec77-6d60-4c6b-b14c-8bb53ebf3f24;name=h1_size}} is the heading size, and {{@(h1_size#a618c388-0d20-4ebe-bcbd-55b9d59094ec#21acec77-6d60-4c6b-b14c-8bb53ebf3f24)*2|56|id=17f45327-90d8-4ef6-bc1e-8ef126499b13;name=h2_size}} is twice it.

### Canvas, HTML, Code

`/canvas` sketches boxes and connectors when position matters. `/html` embeds a real interactive prototype in a sandbox. Ordinary fences hold code:

```python
def summarize(notes: list[str]) -> str:
    return f"{len(notes)} notes ready to review"
```

An image from the vault:

![A sample image](assets/sample-image.png)

## Comments

Select text and press `⌘⇧A` to comment on exactly that phrase. Comments live in a sidecar file beside the note, so they travel with the vault and never touch the sentence they annotate.

- %%i:onboarding-user-comment:start%%Your own comments stay editable — leave yourself a review note and revise it later.%%i:onboarding-user-comment:end%%
- %%i:onboarding-agent-comment:start%%The agent can leave comments too, and its own are labelled as its own.%%i:onboarding-agent-comment:end%%
- %%i:onboarding-external-comment:start%%A coding agent working in the repo can write review notes back into the vault the same way.%%i:onboarding-external-comment:end%%

Open the **Comments** tab in the right panel to reply or resolve. Resolving keeps the thread and its history; it does not erase the conversation.

## The Agent

Press `⌘K` to open the action composer over whatever you are reading. Type `@` to pull another note in as context, and `⌘Enter` to send.

An action is attached to the note you composed it over, and its whole transcript — messages, file edits, approvals — lives under **Actions** in the right panel. The agent edits the vault directly, and it reviews its work by leaving anchored comments, so you answer inline instead of reading a diff.

Prompts worth trying:

- `Summarize this note and propose a better outline.`
- `Read the linked notes and leave comments where they disagree.`
- `Turn the checklist above into a plan with owners.`

The agent runs on your own subscription — Claude Code or Codex — and the app speaks to whichever you have installed. Nothing about your vault leaves the machine unless you turn on sync yourself.

## Properties

Frontmatter at the top of a file is the only place properties live. Open **Properties** in the right panel to edit them, or write the YAML by hand — both touch the same bytes.

| Property      | For                          |
| ------------- | ---------------------------- |
| `description` | One line of what the note is |
| `tags`        | Grouping and search          |
| `status`      | A light state you choose     |
| `type`        | The kind of note             |

## Getting Around

| Action                        | Shortcut             |
| ----------------------------- | -------------------- |
| Ask the agent                 | `⌘K`                 |
| Command palette and search    | `⌘P`                 |
| Daily note                    | `⌘D`                 |
| Comment on the selection      | `⌘⇧A`                |
| Find in this note             | `⌘G`                 |
| Zen mode                      | `⌘\`                 |
| Inline code                   | `⌘E`                 |
| Checklist / bullets / numbers | `⌘⇧C` / `⌘L` / `⌘⇧L` |

Anything the app can do, the `inteligir` command can do too — the agent drives the same commands you would.

## What's Next

Open [[Use Cases|f2745aa0-f394-4469-963d-438f2dd9fd5a]] for a workflow to try on real work, or [[Kitchen Sink]] to see every construct at once. Then edit this note — it is yours now.
