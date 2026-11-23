# Inteligir

> Notes, plans and saved pages, in one personal workspace.

Folders, lists and notes nest in one tree, a list groups its notes by status
and carries properties, and a note is built from rich blocks. Every note is
markdown underneath, notes link to each other and to what you saved, and the
whole library exports as markdown files in their folders. It's made for one person, not a team: no seats, roles or admin panels.
Your Mac, your iPhone and a browser tab all show the same library.

- **Write**: notes in blocks (to-dos, toggles, tables, callouts, columns,
  tabs, charts, formulas, diagrams), linked to each other and to what you
  saved; a note can hold notes.
- **Plan**: a list is a board, grouped by a select such as Status, with the
  text, link and select properties you give it.
- **Save**: links, articles, videos, images, PDFs and files land beside your
  notes, each a page of its own, read for you without a model.
- **Ask**: the built-in agent searches, files, tags, summarizes and edits with
  you, and every change it makes can be undone.

Save from Chrome, Arc, Brave or Edge with the browser extension, by pasting or
dropping onto the window, or from your iPhone's share sheet. The extension
reads the page you save from it, and our cloud reads every other link you
save; no model is asked. Your own Claude or ChatGPT can reach the same
library through the connector, once you connect it.

## Get it

**[Download for Mac (Apple silicon)](https://inteligir.com)**

What you need:

- An account, which needs an invite while it's early; its first 1 GB is free.
- A Mac with Apple silicon, or a browser for your library at
  inteligir.com/library.
- To save from your browser, Chrome, Arc, Brave or Edge with the Inteligir
  extension, which saves as whoever is signed in to inteligir.com in that
  browser.
- Nothing else to install, and no plan of your own for the built-in agent.

Your library lives in your account, so it needs a connection to open, edit,
search and ask the agent, and says so when there is none. The Mac app shows it
from inteligir.com; the iPhone shows what you last opened with no connection.
A page you save from the browser extension or the iPhone's share sheet while
offline waits there and lands once you're back. The iPhone app comes by
TestFlight invite.

Bringing notes or bookmarks with you? Import a zip of markdown notes or a
Raindrop CSV backup from Settings › Import.

What each device sends, and where: [docs/privacy.md](./docs/privacy.md).

## For developers

One Next.js app on Vercel ([`apps/web`](./apps/web/README.md)) serves the
site, the accounts, the cloud and the built-in agent, each account's library
its rows in Postgres on Supabase and its files in Vercel Blob; the Mac app's
window, the browser tab, the iPhone app and the browser extension read and
write it online over one `/v1` wire. The signed Mac build is on the
latest GitHub release, the iPhone app ships to TestFlight and the extension to
the Chrome Web Store ([`docs/releasing.md`](./docs/releasing.md)).

- [`AGENTS.md`](./AGENTS.md): the premises, the quickstart, the map of
  workspaces and the rules; each workspace's README its own map.
- [`docs/development.md`](./docs/development.md): every command, port and
  gate.
- [`CONTEXT.md`](./CONTEXT.md): what the words mean.

## License

Licensed under the [MIT license](./LICENSE).
