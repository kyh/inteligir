# inteligir Highlights

A highlight is a passage of an item and an optional note on it: a claim to check, a decision, or an
answer to the person's question, attached to exact evidence. Ordinary wording and structure
problems are not highlights — fix those in the text and move on.

## Adding One

Add a highlight with `add_highlight`: the item, the passage's exact text as `read_item` showed it
(its plain words, with no markers or markdown), and a note when you have something to say about
it. The library finds the passage and marks it. A passage the item's text does not hold is kept as
an unplaced highlight, listed under the item, rather than lost; a saved link still waiting for its
page places it once the page is read.

`list_highlights` lists an item's highlights and their notes, or the whole library's since a date.

## Markers In The Text

`read_item` shows where each highlight sits with a pair of markers around its passage:

```text
The %%i:c1:start%%rollback path%%i:c1:end%% is unproven.
```

- Both edges carry the same id. Several highlights can share one range:
  `%%i:a,b:start%%text%%i:a,b:end%%`.
- To highlight a block — an image, chart, canvas, HTML block, or fence — each marker sits on its
  own line above and below it.
- Markers inside a code fence are inert, like everything else in code.

The markers are the person's highlights. When you edit around one, keep both edges exactly where
they are; an edit that takes one away leaves its highlight unplaced, and `edit_item` names every
highlight it left so. Never type a marker yourself: `add_highlight` is how a highlight is made.

## Notes And Replies

- A highlight with an empty note is a bare highlight: the passage alone mattered.
- Use a highlight to point the person at a passage; never to fix wording.
- Removing a highlight is the person's to do, in the app.

## Who Wrote It

Every highlight records who made it: the person, an assistant, or you. Yours are marked as the
agent's, so the person can tell your notes from their own.

## Before You Finish

- Every highlight you meant to add went through `add_highlight`, with the passage's exact words.
- Every marker you read is still in the text, both edges where they were.
- `edit_item` named no highlight you did not mean to leave unplaced.
