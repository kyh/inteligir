# Inteligir

> One library for everything you save.

Save links and articles, videos, images, PDFs and files beside the notes you
write, in one library in your account, which your Mac, your iPhone and a
browser tab all show. It does the work of a bookmark manager like Raindrop and
a notes app like Obsidian at once.

Save from Chrome, Arc, Brave or Edge with the browser extension, by pasting or
dropping onto the window, or from your iPhone's share sheet; a page is read
without asking a model. When you ask, the built-in agent files, tags,
summarizes and edits your library with you on any of your devices, and every
reply that changed something can be undone. Claude or ChatGPT can reach the
same library too, once you connect it.

## Get it

**[Download for Mac (Apple silicon)](https://inteligir.com)**

What you need:

- An account, which needs an invite while it's early; its first 1 GB is free.
- A Mac with Apple silicon, or a browser for your library at
  inteligir.com/library.
- To save from your browser, Chrome, Arc, Brave or Edge with the Inteligir
  extension.
- Nothing else to install, and no plan of your own for the built-in agent.

The Mac and the iPhone keep a copy of your library, read it with no connection
and send what you change once they have one. The iPhone app comes by
TestFlight invite.

Coming from Raindrop or Obsidian? Import a Raindrop CSV backup, or a zip of
your notes, from Settings › Import and export.

What each device sends, and where: [docs/privacy.md](./docs/privacy.md).

## For developers

Each account's library is one SQLite Durable Object, its library cell, on the
one Cloudflare Worker [`apps/web`](./apps/web/README.md), which also serves the
site, the accounts, the library's files in R2, the reading of saved pages and
the connector a person's own assistant reaches the library through. The Mac
app ([`apps/desktop`](./apps/desktop/README.md)), the iPhone app
([`apps/mobile`](./apps/mobile/README.md)) and the library's page in a browser
tab each hold a replica of the library and send their writes through one
`/v1` wire; the browser extension ([`apps/extension`](./apps/extension/README.md))
saves over the same wire. The built-in agent is the Worker's own loop over
Claude through AI Gateway, one Durable Object a conversation, its tools the
library's procedures.

### Install & run

The Mac app is the product: a window over the library's page, its replica
and its credential kept in the shell. The signed, notarized macOS build is on
the latest GitHub release (the site's Download button reads it), and an
installed app updates itself on quit.

From a checkout, with the prerequisites in
[`docs/development.md`](./docs/development.md#prerequisites) installed:

```bash
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars
pnpm dev:web          # the Worker on miniflare at http://localhost:5174, the library at /library
pnpm dev              # the Mac app's window over that Worker
```

The local Worker's built-in agent answers from a scripted Claude, with no key
and no model; [`AGENTS.md`](./AGENTS.md) § Quickstart says how to sign in.

### Layout

[`AGENTS.md`](./AGENTS.md) § Map has one line per workspace of the product,
and each workspace's README its own layout.

Boundaries are enforced, not documented: `tools/repo-guards` derives the
dependency DAG from the tree and fails on an undeclared edge, a cycle or an
import the importer's manifest does not list, and `oxlint.config.ts` fails a
package acquiring a platform it may not have (`@repo/notes` runs in the
browser and on node; `@repo/domain` and `@repo/contract` touch neither node
nor react). knip fails a dependency nothing imports.

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
