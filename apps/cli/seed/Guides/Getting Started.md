---
id: a618c388-0d20-4ebe-bcbd-55b9d59094ec
saved: 2026-10-17T11:58:00Z
description: A tour of inteligir, written in the blocks it describes.
tags:
  - guide
status: reference
---

# Getting Started

inteligir keeps everything you save and write in one library: links and articles, pictures, PDFs and other files, and your own notes. Every item is a file in a folder on this Mac, and the file's name is the item's title. Everything below is something you can use yourself — this note is written with it.

Open [[Kitchen Sink]] for every kind of block in one place, or go back to [[Welcome]] for the short version.

## Saving

There are several ways in, and each lands in **Unsorted** unless you are looking at a folder, which a save from the window lands in instead:

- Paste a link anywhere in the window, or drop links and files onto it.
- Choose **Save link…** in ⌘P, or just type a web address there.
- Click the [Inteligir extension](https://chromewebstore.google.com/detail/biedbnmohmigikheljajjdmhhdgnibom) in Chrome, Arc, Brave or Edge, or right-click a page, a link, a picture or a selection. A selection is saved as a highlight on the page.
- On your iPhone, share a page or a link to **Save to Inteligir**, or type into **Save a link or a thought**.

Saving is instant and free: your Mac reads the page's title, picture and text itself, without asking the agent. A page that can't be read says why, and **Refresh from the page** in ⌘P tries again. When you want a page exactly as it looked, choose **Keep a copy of the page** and the copy is kept beside the item.

Pictures, PDFs, videos, sounds and other files up to 10 MB are kept as they are, each as an item of its own. Saving something you already have adds to the item you have rather than making a second one.

## Reading and Highlights

Double-click a card, or press Return, to open it. A saved page opens as its article under where it came from, with **Open original**; a picture, a PDF, a video or a sound opens in its own viewer. Press Space for a quick look without leaving the library, and Escape to go back to it.

Select words and press ⌘⇧H to highlight them. A box opens for a note: press Return to save it, or Escape to keep just the highlight.

- %%i:onboarding-user-highlight:start%%Your own highlights keep their notes, and you can change a note whenever you like.%%i:onboarding-user-highlight:end%%
- %%i:onboarding-agent-highlight:start%%The agent can highlight passages too, and its own are labelled as its own.%%i:onboarding-agent-highlight:end%%

Open the **Annotations** tab in the right panel to see every highlight with its note, reply to one, or remove it.

## Writing

**New note** is in the **Add** menu at the top of the library. Select text for the formatting toolbar, or type `/` for the block menu.

- **Bold**, _italic_, ~~strikethrough~~
- <mark data-color="yellow">Highlight</mark> and <u>underline</u>
- Headings with `##`, quotes with `>`

Lists and checklists carry the work:

- [x] Open a note
- [ ] Highlight a sentence and add a note to it
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

### Links

Type `[[` to link any item in your library. Links keep working when you rename or move an item, and a link to a note that does not exist yet shows dashed and offers to create it.

- [[Kitchen Sink]] — a plain link
- [[Kitchen Sink|the block tour]] — a link with its own words
- [[#Writing]] — a jump inside this note

Tag a note by writing a word after `#`, like #guide, and click the tag to see every item that carries it.

Open **Related** in the **Info** tab of the right panel for both halves of the picture: items that link here, counted, and items the app thinks belong with this one, each with its reason.

### Charts

```inteligir-chart
{"type":"line","title":"Items saved","series":[{"name":"This month","data":[{"label":"Week 1","value":8},{"label":"Week 2","value":14},{"label":"Week 3","value":11},{"label":"Week 4","value":19}]}]}
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

`/canvas` sketches boxes and arrows when position matters. Paste an image into a note and it is kept in your library beside it:

![A sample image](assets/sample-image.png)

The `/` menu holds more — toggles, columns, equations, diagrams — and [[Kitchen Sink]] shows every one.

### Properties

Properties are short facts about an item, kept at its top. Edit a note's under **More properties** in the **Info** tab; a saved page's address, description and tags are right in **Info**.

| Property      | For                          |
| ------------- | ---------------------------- |
| `description` | One line of what the item is |
| `tags`        | Grouping and search          |
| `status`      | A light state you choose     |

## Organizing

The sidebar lists **All items** and **Unsorted**, your folders and your tags; choose one to narrow the library, and a kind above it (Links, Images, PDFs, Notes…) to see just that kind. Click a card to select it, ⌘-click or ⇧-click to select more, and drag cards onto a folder to move them. Right-click a card to tag it, move it, pin it to the top of your library or delete it.

**Tidy my library**, at the top of Unsorted and in ⌘P, asks the agent to file and tag what is waiting there and everything with no tags, following your filing rules. The rules are a page you write in your own words: choose **Edit filing rules…** in the menu beside Tidy, or open them from Settings › Agent. **Undo changes** takes a tidy back.

## Asking the Agent

Press ⌘K to ask the agent about what you are looking at: the item you have open, or in the library the items you selected, or the whole view when none are. Type `@` to add other items, and press Enter to send. If you have not signed in yet, it asks you to sign in with Claude or ChatGPT first: the agent works on your own plan.

The conversation lives under **Actions** in the right panel. When the agent changes your library, a message says how many items it edited, with **Undo**, and each of its replies lists what it changed, with **Undo changes**. Undo takes back only that reply's changes and keeps every edit made since, yours included.

Prompts worth trying:

- `Summarize these into one note.` — with a few items selected
- `Pull the action items out of this note into a checklist, with an owner and a date for each.`
- `Read the linked items and highlight where they disagree.`
- `Draft the next section from my bullets, in the same plain tone as the first.`
- `Read this week's notes and write a review: what got done, what slipped and why, and three priorities.`

To speak instead of typing, press fn twice in the ⌘K box and your Mac takes dictation.

What you ask the agent, and the items it reads to answer, go to Claude or ChatGPT under your own plan.

## History and Deleted

Every item keeps its earlier versions. Open **History** in the right panel to see each version, when it was made and by whom — you, the agent or another device — and what changed, then **Restore** the one you want.

A deleted item is not gone. Choose **Deleted** in the sidebar and restore it from there, with its highlights and the pictures and files it held.

## Your Account, Other Macs and Your iPhone

Without an account, your library lives on this Mac alone. Create one with your invite code, or sign in, from **Sign in…** at the bottom of the sidebar or in Settings › Account. An account backs up your library and brings it to your other devices; your online library is free up to about 1 GB:

- Sign in on another Mac and your library arrives there as it is.
- On your iPhone, see and edit the same library, save from any app's share sheet, add photos and highlight. A link you save there is read by your iPhone once it's online, with no Mac needed. The agent runs on your Mac: ask it there, and what it changes reaches your iPhone.
- If two devices change the same lines of an item, both versions are kept, and the app tells you where the other one went.
- A file over 10 MB stays on the Mac it is on.

Settings › Account lists your devices and signs out one you have lost.

## Bringing Your Bookmarks

**From Raindrop**: download a backup of your Raindrop bookmarks as a CSV file, then choose **Import from Raindrop…** in ⌘P, the **Add** menu or Settings › Library. You see what it will add before anything is added; each collection becomes a folder, with its tags, notes and highlights, and the pages fill in over the next while.

**From Obsidian**: an Obsidian folder is already a library. Choose **Switch or open another library…** from the library's name at the top of the sidebar, or **Open Library…** in the File menu, and pick it. Its notes stay where they are, as they are.

## Getting Around

The palette's Keyboard shortcuts page lists every shortcut.

| Action                        | Shortcut             |
| ----------------------------- | -------------------- |
| Ask the agent                 | `⌘K`                 |
| Command palette and search    | `⌘P`                 |
| Highlight the selection       | `⌘⇧H`                |
| Find in this item             | `⌘F`                 |
| Go to heading                 | `⌘⇧O`                |
| Quick look at a card          | `Space`              |
| Back to the library           | `Esc`                |
| Zen mode                      | `⌘\`                 |
| Settings                      | `⌘,`                 |
| Checklist / bullets / numbers | `⌘⇧C` / `⌘L` / `⌘⇧L` |

The same chords are in [[Keyboard shortcuts]], a PDF waiting in Unsorted.

## What's Next

Try **Tidy my library** on the four example saves in Unsorted, or open [[Kitchen Sink]] to see every block at once. Then edit this note — it is yours now.
