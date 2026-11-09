# Decisions: @repo/agent-panel

The built-in agent's panel as every device reads it. `AGENTS.md` § Decisions
says how a bullet is written and cited.

## The panel

- **A CONVERSATION'S LOGIC IS ONE PACKAGE, AND EACH DEVICE DRAWS IT** (owner
  decision: the phone gets the built-in agent). The events a thread's rows
  carry, folded into what a conversation draws, the approval waiting, each
  turn's ending and Undo, the reply the socket previews, the person's words for
  each state and refusal, and what a send asks (the words, the thread and the
  screen it leaves from) are pure functions over the contract's own union, so
  the Mac, the tab and the phone say one thing of one conversation. It imports
  no platform and no UI (`oxlint.config.ts`): the page draws it with `@repo/ui`
  (`apps/web/src/library/agent/agent-panel.tsx`), the phone natively.
  Rejected: the phone drawing the page's panel in a WebView (a second page, and
  the composer under a soft keyboard the page cannot lay out); a copy of the
  fold per device (the words drift).
  `packages/agent-panel/src/thread-entries.ts`, `agent-send.ts`.

- **AN APPROVAL SAYS WHAT ITS CALL WOULD DO, READ OFF THE CALL.** A card counts
  the items a delete would move and names the first it holds, and shows the
  whole address a save would send a site, read off the event's input, because
  the card is the one gate on a call a hostile page may have prompted. Rejected:
  a fixed sentence per tool beside the agent's own reply (the reply is what such
  a page writes); a title the cell puts on the event (every device already
  holds it). `packages/agent-panel/src/thread-entries.ts`.
