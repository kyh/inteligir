# Changelog

What changed in Inteligir, the desktop app and the `inteligir` command line, newest first. Each release's notes on GitHub are its section here, word for word.

## Unreleased

Everything since 0.4.0 (September 4, 2026).

### Before you update

- **`inteligir vault write` no longer overwrites a note silently.** It now needs exactly one of `--if-absent` (create only), `--expected-hash <hash>` (replace only if the note still holds what you read; `inteligir vault read --json` prints the hash) or `--overwrite` (replace whatever is there). A script that relied on the old behaviour needs `--overwrite`. It also refuses an empty or interactive stdin: pass `--content ''` when you mean to empty a note.
- **A browser tab signs in only through a one-time link.** Opening the server's address, or a bookmark of it, now shows a signed-out page instead of your notes. `inteligir serve --open` still opens a signed-in tab; for another one, run `inteligir open` or use File › Open in Browser in the app. Each link works once and expires after five minutes. The server also answers only requests addressed to `127.0.0.1` or `localhost`.
- **The command line and the app must be the same release.** An `inteligir` installed from npm refuses to talk to a server of another version (exit code 3) and names both versions, and the app no longer takes over a running `inteligir serve` of another version. Update both together.
- **Flags go after the command.** `inteligir --json vault read notes/a.md` is refused; write `inteligir vault read notes/a.md --json`. Extra words and unknown flags are refused too, where they used to be ignored.
- **The model setting is per agent.** `INTELIGIR_AGENT_MODEL` and the `agentModel` key in `config.json` are no longer read, because one model name was handed to both agents. Set `INTELIGIR_CLAUDE_MODEL` or `INTELIGIR_CODEX_MODEL`, or `"agentModels": { "claude": "…", "codex": "…" }` in `config.json`. The server warns at start-up when it finds the old setting.
- **Comments moved into one folder in your vault.** A note's comments now live in `.inteligir/comments/`, in a file named after the note's `id`, so moving or renaming the note anywhere (in Finder, with git, by an agent) keeps them. Existing `<note>.comments.json` files move there on the first launch. Commenting on a note that has no `id`, or starting an action from it, adds one to the note's properties (its frontmatter). Deleting a note deletes its comments, and restoring the note brings them back.
- **A pin is a property.** Pinning a note writes `pinned: true` into it, so the pin follows the note to your other devices and to the agent.
- **Videos, posts and images from the web are no longer loaded inside a note.** YouTube, tweets, iframes and remote images or PDFs show a card with Open in browser. The installed app's security policy already blocked them, so they drew broken; now they say what they are.
- **The app's own git runs skip your vault's git hooks.** A hook in the vault (`pre-commit`, `commit-msg`, `post-commit`, `pre-rebase`, `pre-push` and the rest) could refuse, stall or rewrite every automatic commit and sync. Your own commits and pushes still run them.
- **Two computers adding to `Inbox.md` no longer jam sync.** Captures from your phone are kept from both sides. One side effect: a line you delete from `Inbox.md` on one computer can come back if the other added a capture at the same moment.
- **Signing out frees the device.** Signing a computer out now removes it from your account's devices, so it stops counting toward the limit.
- **A second vault starts fresh.** Every vault besides the first keeps its own sign-in, connectors and default agent, so it starts signed out, with no connectors and no default agent chosen. Settings says so where it matters.
- **Agents ignore agent settings kept inside your vault.** Your vault syncs from other devices and git remotes, so a vault can no longer configure the agent that works in it. Claude Code skips the vault's `.claude` folder, `.mcp.json`, `CLAUDE.md` and `CLAUDE.local.md`, and MCP servers added with `claude mcp add` from inside the vault folder; Codex won't open on a vault that holds a `.codex` folder until you remove it. Instructions for the agent belong in the vault's `AGENTS.md`, which both agents still get. Add MCP servers in Settings › Connectors, or at user level in Claude Code (`claude mcp add --scope user`) or Codex (`~/.codex/config.toml`).
- **What your `.gitignore` files leave out, the app leaves out too.** A folder or file a `.gitignore` in the vault names (a docs repo's `node_modules/` or build output, say) no longer shows in Files, ⌘P, search or links, and changes inside it no longer wake the app. A note you want to see again needs taking out of `.gitignore`.
- **Dictation is your Mac's own.** The microphone button in the ⌘K composer, Settings › Voice and the downloaded speech model are gone, and the app no longer asks for the microphone; the model's folder is deleted on the first launch. To dictate, press fn twice (or the 🎤 key), or choose Edit › Start Dictation, wherever you type.
- **`inteligir connectors` is gone.** Add and remove connectors in Settings › Connectors, or at user level in Claude Code (`claude mcp add --scope user`) or Codex (`~/.codex/config.toml`); a script that ran `inteligir connectors add` needs one of those instead.

### New

- **Stop a running action.** A Stop button sits in the action's header while the agent works; `inteligir action stop` does the same, and archiving a running action stops it.
- **Undo what the agent changed.** When an action finishes editing your notes, a message says how many it edited, with Undo, and each of the action's replies lists the notes it edited with Undo changes. Undo takes back only that reply's changes and keeps every edit made since, yours included; a note edited in the same place since is left as it is and named, with Open History.
- **More than one vault.** Open another folder as a vault from File › Open Vault…, the vault's name at the top of the sidebar, or Settings › Vault; recent vaults are one click away. `inteligir vault open <folder>` picks the vault the server opens next time it starts.
- **Templates.** Notes in a `templates/` folder are templates: New note from template… and Insert template… in the command palette (⌘P), and a Templates group in the `/` menu. `{{date}}`, `{{time}}` and `{{title}}` are filled in, and `templates/Daily.md` shapes the daily note (⌘D).
- **Search and replace across the vault.** Search across the vault… in ⌘P lists every match with its line, with match-case and whole-word options, and can replace them all. It shows its progress, can be stopped between notes, and leaves alone any note that changed while it ran, naming it. On the command line: `inteligir matches`.
- **Find and replace in a note.** ⌘F opens the find bar under the Find button; ⌥⌘F opens it with Replace.
- **Go to heading** with ⌘⇧O, and **Extract to new note** from the selection toolbar or a block's menu: the selected blocks become a new note and a link to it, and one undo puts them back.
- **Problems.** A Problems page in ⌘P (and `inteligir problems`) lists links that lead nowhere, missing embeds, notes nothing links to, two notes with the same name and two notes sharing one `id`. Picking a row jumps to the link. Two notes share an `id` when one was copied outside the app (Finder's Duplicate, say); picking the copy gives it an `id` of its own and a copy of its comments, so each note keeps every comment it had. On the command line: `inteligir vault new-id`.
- **Unlinked mentions.** Related, in the panel's Metadata tab, now lists notes that mention this one without linking to it, with a Link button that turns the mention into a link. On the command line: `inteligir unlinked`.
- **Tags.** Clicking a `#tag` shows its notes in the sidebar with their count, and from there you can rename the tag across the whole vault, nested tags included. On the command line: `inteligir tag notes` and `inteligir tag rename`.
- **Pin notes** from a right-click in the sidebar, the Metadata tab or ⌘P. Pinned notes sort to the top of Recent.
- **Move notes and folders** by dragging them in Files, or with Move note to folder… in ⌘P. Links into and out of everything that moved are rewritten, whole folders included.
- **Files** sorts by name or by newest, and a right-click offers Reveal in Finder, Open with default app, Copy path and Copy absolute path.
- **Choose where pasted images go**: the top of the vault, beside the note, or a folder (`assets/` unless you pick another), in Settings › Vault or with `inteligir vault attachments`.
- **Choose your default agent**, Claude or ChatGPT, in Settings › Agents or with `inteligir agents default`. An action keeps the agent it started with.
- **Add a connector by its address alone.** For an MCP server that signs in with OAuth, paste its URL; the app finds its sign-in page and registers itself.
- **Spell check** can be turned off in Settings › Editor; outside macOS you can also pick its languages.
- **A Keyboard shortcuts page** in ⌘P, spelled for your keyboard. ⌘, opens Settings, and `[` and `]` hide and show the sidebar and the panel while you are not typing.
- **Facts about a note** in the Metadata tab's About section: where it lives, when it was changed and first created, its words, characters and reading time, and how many notes link to it. The word count and reading time also sit under the note.
- **Link previews you can use.** Hovering a `[[link]]` shows a card you can move into, select text from, and open by its title.
- **What's new** in Settings › About opens this changelog.
- **Create your account in the app.** Sign in… in the sidebar's sync menu and Settings › Devices now offer Create an account: your name, email, a password and your invite code, and this computer is signed in to the new account at once, with no second sign-in. Signing in has a Forgot password? link that opens the page which emails you a reset link.
- **On the command line:** `inteligir open` opens another signed-in browser tab; `inteligir action list` pages with `--limit` and `--cursor`, filters with `--doc` and `--running`, and leaves archived actions out unless you pass `--archived`; `inteligir action wait` names an approval it is waiting on, and `--until-input` exits 4 when one arrives; `inteligir action changes` lists the notes each of an action's turns changed, and `inteligir action undo` takes one turn's changes back while keeping every edit made since, naming any note it had to leave as it is; `inteligir agents list` shows which agents are installed and signed in.
- **Diagnostics for "it didn't update".** Turn on Debug logging in Settings › Advanced and restart the app when it asks: it then logs what it did with each file change, each file it indexed, each sync step and each message to an agent. Lines name files and ids, never what a note says, so they are safe to paste into a report, and Show log finds the file. The app keeps what it logs, debug or not, in `logs/server.log` in its data folder, at most 5 MB plus one older file; it never leaves your Mac unless you send it. On the command line, start the server with `INTELIGIR_DEBUG=watcher,knowledge,sync,acp` (any of them) for the same lines.
- **Make, rename and delete notes on your phone, and add photos.** New note in the phone's notes list starts one, and a long press on a note renames or deletes it. Renaming updates every link to the note; a note another device changed first keeps its link, which still opens the note by its old name. Deleting a note deletes its comments too, and Deleted on your Mac brings both back. Add photo in a note takes a picture or picks one from your library and adds it to the end of the note, as a smaller copy without the place it was taken. It all works offline and reaches your Mac once the phone is back online.

### Changed

- **The sidebar is simpler.** The label at the top of the list switches between Recent, Files and Deleted, with New note beside it; everything else is a right-click. Deleted notes are a list there now, not a dialog, and a right-click restores one. The bottom row carries sync and your account (sign in, sync now, sign out), with Settings and the theme beside it. The vault's name at the top switches vaults.
- **⌘P is the one search.** The sidebar's search box is gone; the search button beside the vault's name opens ⌘P, which finds notes and commands and leads on to vault-wide search, Problems and shortcuts.
- **The top bar shows the folders above the note**; clicking one opens it in Files. Find, Comments and the panel toggle stay in the bar, and Copy link, Export and Share with agent moved under its ⋯ menu.
- **Settings opens over your note** instead of replacing it. The note, its undo history and an open ⌘K composer are still there when you come back.
- **The right panel** has four tabs: Actions, Comments, History and Metadata. A note's properties moved from above the tabs into Metadata, beside Related and Delete note. The panel now starts closed until you open it, and its width is remembered like the sidebar's.
- **Actions** take their title from their first message wherever they start (the command line, the agent, another device) instead of "Untitled action". Notes you @-mention travel with the message and show as chips under it. An action's title, its note, its agent and whether it is archived now reach your other devices. The Actions list loads a page at a time, with Show more.
- **The outline beside a note** appears once the note has three headings.
- **One set of text sizes** across the app's menus, lists and panels. Popups now animate out as well as in, and the app follows your system's reduce-motion setting.
- **Pushing more than 90 MB** to your account's hosted vault now says it is too large and stops retrying, without uploading it first, instead of failing with git's raw error every minute.
- **An action another device is running** says so in its header instead of offering a Stop button that could not stop it.
- **Sync reports what it could not send.** Settings › Advanced and `inteligir cloud status` count action events this computer dropped without sending, and a sign-out that could not remove the device from your account says so and points to the Devices page.
- **The app is smaller.** It no longer carries the command line's source code and tests inside it.
- **The agent talks about your notes in plain language.** It no longer brings up version control or the command line unless you ask, and it never asks you to run a command. Instructions you keep in your vault's `AGENTS.md` still have the last word.
- **Sync and History speak plainly.** The sync row at the bottom of the sidebar says Synced, Not synced yet, Only on this Mac, Offline or Sync paused instead of a technical error message; when sync needs you, Sync details… opens the new Settings › Advanced, which keeps the full detail. Actions sync on their own, so the row no longer offers a separate sync for them. History lists each version by when and who made it (you, the agent, or another device or person), and restoring one says which version came back.
- **The agent writes the same callouts you make from the `/` menu** (Note, Tip, Important, Warning and Caution), and a new vault's starter notes use them too. Callouts already in your notes in the older form still show and save unchanged.
- **The agent needs nothing else installed.** Claude and ChatGPT run from inside the app, so neither Claude Code nor Codex has to be on your Mac, and a Mac already signed in to either stays signed in. Settings › Agents and `inteligir agents list` show each one's sign-in as Claude or ChatGPT reports it, with the plan and account.
- **One Date row in the `/` menu.** Day inserted the same date chip; `/day` now finds Date.
- **Copy link copies a link for another note.** ⋯ › Copy link now copies the note's `[[Name]]`, the link the `[[` menu writes, instead of a web address that worked only while the app was open.
- **A folder you open keeps the sync it already has.** A folder that iCloud Drive, Dropbox, Google Drive, OneDrive or Obsidian Sync already keeps in sync stays with that service: the app leaves its own sync off for it, even when you are signed in, so two services never fight over one folder, and the sidebar says which one syncs it. A folder that already syncs with a server of its own keeps syncing there and never moves into your account.
- **Settings › Advanced keeps the technical detail in one place.** The data folder (with Open data folder), the database version and uptime moved there from About, and this device's id, queue and last error from Devices, beside your vault's sync detail; Sync threads now moved with them, since actions sync on their own. Devices keeps your account and Sign out.

### Fixed

- **An edit that lands while you type is kept.** When an agent or another app writes the open note, the change reaches the screen and the next save keeps it; before, it could stay hidden until you typed again, or be erased by the next save. When two edits truly clash, a message offers Open History.
- **A save that fails says so** and is retried. A note deleted while it had unsaved edits asks whether to discard them or create the note again.
- **Line breaks survive saving.** A line break right after a link, tag or formula no longer joins the two lines, and a note that could lose one opens as raw text instead of being rewritten.
- **Saving no longer mangles** `> [!note]` alerts (saved as `\[!note]`), formulas picked from the `{{` menu (saved with a stray `\{`), an empty inline equation (turned into dollar signs), or `|` inside code, math or properties.
- **Renames and moves keep links right.** A `[[Title|id]]` link follows its note, renaming a note to another note's alias no longer takes over that alias's links, a name containing `#` is written so it still resolves, a moved note keeps its images, and a note that starts with a byte-order mark renames cleanly.
- **Comments** that span paragraphs, or start inside a callout or a table, now highlight and show their marker. A second comment on a note appears at once, and deleting a duplicated note no longer takes its twin's comments.
- **Folding and dragging follow your edits.** A new heading gets its fold arrow, and a fold or a drop lands on the right block.
- **Typing Chinese, Japanese or Korean** no longer submits half-composed text when Enter confirms a candidate.
- **Run on an HTML block** runs the block's scripts, in a sandbox.
- **Agent errors are readable.** "[object Object]" is gone, and an agent that is signed out says so.
- **A stuck or crashed agent no longer wedges an action.** The next message starts cleanly, a crash ends the turn with its reason, a queued message keeps its place in line (after a failed turn too), and a refused approval can be answered again.
- **Signing in again no longer duplicates your own actions**, and the duplicates an earlier sign-in left behind are removed once, on the first launch.
- **Sync.** Saves no longer wait while the network is down; a refused push or a detached branch is reported as such instead of Offline or Synced; a failed automatic commit shows as the sync error; sync works where git has no name or email configured; and one bad entry no longer holds up your phone's captures.
- **Big vaults and big notes.** A very large note no longer freezes the app while it is indexed, a folder with a thousand notes opens at once, a very long paragraph no longer slows every save, and new or deleted notes show up in ⌘P right away.
- **An unreadable file** costs only that file, never the whole file list or the search index.
- **One folder is one vault**, however its path is spelled: `~/Notes` and `~/notes`, or a path through a symlink, no longer open as two vaults with separate sign-ins and history.
- **A browser tab whose sign-in stopped working**, say after the server restarted, shows one signed-out notice instead of an error for every request.
- **Quitting during start-up** quits, and a vault switch that fails says so and goes back to the vault you had.
- **`inteligir serve`** refuses to start a second server on the same data folder, and closing its terminal still saves pending changes to the vault.
- **Settings.** Choice rows respond to the arrow keys, and a connector shows as connected as soon as its sign-in finishes.
- **A settings file the app cannot read** is reported by name instead of being treated as empty and overwritten.
- **Typing in a long note is quicker**, and the save after you stop typing in one takes a fraction of the time it did.
- **A vault on slow storage** (iCloud Drive files not yet downloaded, a sleeping disk, a network folder) no longer holds up search. A note that takes more than two seconds to read keeps its last search entry and catches up once it arrives.
- **Typing while a note is renamed or moved** is kept; before, keystrokes during the move could be lost.
- **Links in notes.** A note link inside an embed opens the note instead of an empty browser tab, the hover preview of `![[Plan]]` reads `Plan`, and a `www.` address or a bare link in bold or italics no longer makes the note open as raw text.
- **Search in ⌘P's Actions page** finds every action, not only the ones already loaded.
- **Undo right after starting an action** no longer removes the `id` the app added to the note for it.
- **What an agent deletes** is committed with the rest of its action, rather than landing in the next automatic commit.
- **`inteligir open`** against a server started without the app's interface says how to fix it, instead of opening a link that leads nowhere.
- **Your phone** no longer re-reads the whole notes list on every refresh when nothing in the vault changed.

### On the command line

- **`vaultRemote` in `config.json` is no longer read.** It applied to every vault the app opened. A vault now syncs with its own repo's `origin`, which it keeps when you sign in: run `git remote add origin <url>` in the vault, or pin one with `INTELIGIR_VAULT_REMOTE`. The server warns at start-up when it finds the old key.
- `inteligir vault open` says when another service syncs the folder or it has a git remote of its own, and `--json` carries both as `externalSync` and `remote`; `inteligir vault status` names the service too.

### Security

- Content inside a note, such as an HTML block, can no longer reach the app's local server with the app's own access.
- A link in a note opens only when it is an `http` or `https` address.
- The installed app can no longer be started as a plain Node.js interpreter, and its cookies are encrypted on disk.
- The installed app checks its bundle's integrity when it starts and loads its code only from that bundle.
