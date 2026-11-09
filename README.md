# Inteligir

> One library for everything you save.

Save links and articles, videos, images, PDFs and files beside the notes you
write, in one library in your account, which your Mac, your iPhone and a
browser tab all show. It does the work of a bookmark manager like Raindrop and
a notes app like Obsidian at once.

Save from Chrome, Arc, Brave or Edge with the browser extension, by pasting or
dropping onto the window, or from your iPhone's share sheet. The extension
reads the page you save from it, and our cloud reads every other link you
save; no model is asked. When you ask, the built-in agent files, tags,
summarizes and edits your library with you on any of your devices, and every
reply that changed something can be undone. Your own Claude or ChatGPT can
reach the same library through the connector, once you connect it.

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

Coming from Raindrop or Obsidian? Import a Raindrop CSV backup, or a zip of
your notes, from Settings › Import.

What each device sends, and where: [docs/privacy.md](./docs/privacy.md).

## For developers

Each account's library is one SQLite Durable Object, its library cell, on the
one Cloudflare Worker [`apps/web`](./apps/web/README.md), which also serves the
site, the accounts, the library's files in R2, the reading of saved pages and
the connector a person's own assistant reaches the library through. The iPhone
app ([`apps/mobile`](./apps/mobile/README.md)) and the library's page, in a
browser tab or the Mac app's window ([`apps/desktop`](./apps/desktop/README.md)),
each read and write the library online through one `/v1` wire, their reads
cached by TanStack Query and refreshed when the account's socket says what
moved; the browser extension
([`apps/extension`](./apps/extension/README.md)) saves over the same wire, on
the browser's own sign-in to the site. Every device signs in with Better
Auth's own session. A
saved page is read by the extension that saved it, on the device, and by the
Worker's fill otherwise, off a Queue. The built-in agent is
the Worker's own loop over Claude through AI Gateway, one Durable Object a
conversation, its tools the library's procedures.

### Install & run

The Mac app is a window on the site's library page (inteligir.com/library).
The signed, notarized macOS build is on the latest GitHub release (the site's
Download button reads it), and an installed app offers each update, which
installs on Restart. The iPhone app ships to TestFlight by EAS, and the
extension to the Chrome Web Store ([`docs/releasing.md`](./docs/releasing.md)).

From a checkout, with the prerequisites in
[`docs/development.md`](./docs/development.md#prerequisites) installed:

```bash
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars
pnpm dev:web   # the Worker on miniflare at http://localhost:5174 (/library)
pnpm dev       # the Mac app's window on that Worker's /library
```

The local Worker's built-in agent answers from a scripted Claude, with no key
and no model; [`AGENTS.md`](./AGENTS.md) § Quickstart says how to sign in.

### Layout

[`AGENTS.md`](./AGENTS.md) § Map has one line per workspace, and each
workspace's README its own layout.

Boundaries are enforced, not documented: `tools/repo-guards` derives the
dependency DAG from the tree and fails on an undeclared edge, a cycle or an
import the importer's manifest does not list, and `oxlint.config.ts` fails a
package acquiring a platform it may not have (`@repo/contract` runs in the
Worker, the browser and the phone, so it touches neither node nor react). knip fails
a dependency nothing imports, and an export nothing reaches.

**[`AGENTS.md`](./AGENTS.md) is the guide for coding agents** — the premises,
the quickstart and the rules, and the index of the `CLAUDE.md` beside each
workspace's code that holds its durable decisions; `CONTEXT.md` is the domain
glossary.

### Develop

[`docs/development.md`](./docs/development.md) owns the commands, the ports,
where state lives and the gate. The one line every change runs before it is
committed:

```bash
pnpm format:fix && pnpm verify
```

## License

Licensed under the [MIT license](./LICENSE).
