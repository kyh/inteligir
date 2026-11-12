# Inteligir

> One library for everything you save.

Save links and articles, videos, images, PDFs and files beside the notes you
write, in one library in your account, which your Mac, your iPhone and a
browser tab all show. It does the work of Raindrop and Obsidian at once.

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

One Cloudflare Worker ([`apps/web`](./apps/web/README.md)) serves the site,
the accounts and the cloud, each account's library one SQLite Durable Object;
the Mac app's window, the browser tab, the iPhone app and the browser extension
read and write it online over one `/v1` wire. The signed Mac build is on the
latest GitHub release, the iPhone app ships to TestFlight and the extension to
the Chrome Web Store ([`docs/releasing.md`](./docs/releasing.md)).

- [`AGENTS.md`](./AGENTS.md): the premises, the quickstart, the map of
  workspaces and the rules; each workspace's README its own map.
- [`docs/development.md`](./docs/development.md): every command, port and
  gate.
- [`CONTEXT.md`](./CONTEXT.md): what the words mean.

## License

Licensed under the [MIT license](./LICENSE).
