---
id: a618c388-0d20-4ebe-bcbd-55b9d59094ec
description: A tour of inteligir, written in the blocks it is describing.
tags:
  - guide
status: reference
---

# Getting Started

inteligir is a notes app with an agent living inside it. Every note is a file in a folder on this Mac, and the file's name is the note's title. Everything below is something you can use in your own writing — this note is written with it.

Read [[Use Cases|f2745aa0-f394-4469-963d-438f2dd9fd5a]] for ways to use it on real work, and [[Kitchen Sink]] for every block in one screen.

## Writing

Select text for the formatting toolbar, or type `/` for the block menu.

- **Bold**, _italic_, ~~strikethrough~~
- <mark data-color="yellow">Highlight</mark> and <u>underline</u>
- Headings with `##`, quotes with `>`

Lists and checklists carry the work:

- [x] Open a note
- [ ] Leave a comment on a sentence
- [ ] Ask the agent something with ⌘K

> A blockquote sets apart a decision or an excerpt worth its own line.

### Tables

| Use a table when          | Instead of                                 |
| ------------------------- | ------------------------------------------ |
| Values repeat across rows | Bullets that restate the same shape        |
| The reader compares       | Prose the reader has to hold in their head |

Cells hold links, pills and formatting, but not lists or other blocks.

### Callouts

Pick **Callout** from the `/` menu and it starts as a note. Click into it and change `NOTE` to `TIP`, `IMPORTANT`, `WARNING` or `CAUTION` for the other kinds:

> [!WARNING]
> A warning callout marks something that will bite if ignored.

> [!IMPORTANT]
> An important callout says what the reader must not miss.

## Linking Notes Together

Type `[[` to link a note. Links keep working when you rename or move a note, and a link to a note that does not exist yet shows dashed and offers to create it.

- [[Kitchen Sink]] — a plain link
- [[Use Cases|the workflows note]] — a link with its own words
- [[#Writing]] — a jump inside this note

Tag a note by writing a word after `#`, like #guide, and click the tag to see every note that carries it.

Open **Related** in the **Metadata** tab of the right panel for both halves of the picture: notes that link here, counted, and notes the app thinks belong with this one, each with its reason. It also lists notes that mention this one without linking to it, with a button that turns the mention into a link.

## Blocks Worth Knowing

### Charts

```inteligir-chart
{"type":"line","title":"Notes written","series":[{"name":"This month","data":[{"label":"Week 1","value":8},{"label":"Week 2","value":14},{"label":"Week 3","value":11},{"label":"Week 4","value":19}]}]}
```

Select a chart to edit its numbers in a grid.

### Tabs

:::tabs
=== Before
The old approach, kept for comparison.

=== After
The current approach, with the reasoning that replaced it.
:::

### Formulas

A pill computes inline: {{2+2|4}}. Give one a name and other pills can build on it — change the first and everything built on it follows:

A budget of {{1200|1,200|id=21acec77-6d60-4c6b-b14c-8bb53ebf3f24;name=monthly}} a month is {{@(monthly#a618c388-0d20-4ebe-bcbd-55b9d59094ec#21acec77-6d60-4c6b-b14c-8bb53ebf3f24)*12|14,400|id=17f45327-90d8-4ef6-bc1e-8ef126499b13;name=yearly}} a year.

### Sketches and Images

`/canvas` sketches boxes and arrows when position matters. Paste an image into a note and it is saved with your notes:

![A sample image](assets/sample-image.png)

The `/` menu holds more — toggles, columns, equations, diagrams — and [[Kitchen Sink]] shows every one.

## Comments

Select text and press ⌘⇧A to comment on exactly that phrase. Comments sit beside the note, never inside your sentences, and stay with it when you rename or move it.

- %%i:onboarding-user-comment:start%%Your own comments stay editable — leave yourself a review note and revise it later.%%i:onboarding-user-comment:end%%
- %%i:onboarding-agent-comment:start%%The agent can leave comments too, and its own are labelled as its own.%%i:onboarding-agent-comment:end%%

Open the **Comments** tab in the right panel to reply or resolve. Resolving keeps the thread and its history; it does not erase the conversation.

## The Agent

Press ⌘K to ask the agent about whatever you are reading. The note you are on goes with your message; type `@` to add other notes, and press Enter to send. If you have not signed in yet, it asks you to sign in with Claude or ChatGPT first: the agent works on your own plan.

The conversation lives under **Actions** in the right panel. The agent edits your notes directly, and it leaves comments where it wants your answer, so you reply in place instead of reading a list of changes.

When it finishes, a message says how many notes it edited, with **Undo**, and each of its replies lists the notes it changed, with **Undo changes**. Undo takes back only that reply's changes and keeps every edit made since, yours included.

Prompts worth trying:

- `Summarize this note and propose a better outline.`
- `Read the linked notes and leave comments where they disagree.`
- `Turn the checklist above into a plan with owners.`

To speak instead of typing, press fn twice in the ⌘K box and your Mac takes dictation.

What you ask the agent, and the notes it reads to answer, go to Claude or ChatGPT under your own plan.

## History and Deleted Notes

Every note keeps its earlier versions. Open **History** in the right panel to see each version, when it was made and by whom — you, the agent or another device — and what changed, then **Restore** the one you want.

A deleted note is not gone. Pick **Deleted** from the label above the sidebar's list, and right-click a note there to restore it, comments and all.

## Properties

Properties are short facts about a note, kept at its top. Edit them under **Properties** in the **Metadata** tab of the right panel.

| Property      | For                          |
| ------------- | ---------------------------- |
| `description` | One line of what the note is |
| `tags`        | Grouping and search          |
| `status`      | A light state you choose     |

Pin a note from its right-click menu in the sidebar and it stays at the top of Recent, on every device.

## Your Account, Other Macs and Your iPhone

Without an account, your notes live on this Mac alone. Create one with your invite code, or sign in, from **Sign in…** at the bottom of the sidebar or in Settings › Account. An account backs up your notes and your conversations with the agent, and brings them to your other devices:

- Sign in on another Mac and your notes arrive there as they are.
- On your iPhone, read and edit the same notes, add photos, and ask the agent. What you ask runs on one of your Macs while it is open.
- If two devices change the same lines of a note, both versions are kept, and the app tells you where the other one went.

Settings › Account lists your devices and signs out one you have lost.

## Getting Around

The palette's Keyboard shortcuts page lists every shortcut.

| Action                        | Shortcut             |
| ----------------------------- | -------------------- |
| Ask the agent                 | `⌘K`                 |
| Command palette and search    | `⌘P`                 |
| Daily note                    | `⌘D`                 |
| Comment on the selection      | `⌘⇧A`                |
| Find in this note             | `⌘F`                 |
| Go to heading                 | `⌘⇧O`                |
| Zen mode                      | `⌘\`                 |
| Settings                      | `⌘,`                 |
| Checklist / bullets / numbers | `⌘⇧C` / `⌘L` / `⌘⇧L` |

## What's Next

Open [[Use Cases|f2745aa0-f394-4469-963d-438f2dd9fd5a]] for a way to try this on real work, or [[Kitchen Sink]] to see every block at once. Then edit this note — it is yours now.
