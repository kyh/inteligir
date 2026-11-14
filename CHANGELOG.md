# Changelog

What changed in Inteligir (the Mac app, the iPhone app, the browser extension and inteligir.com), newest first. The top section becomes the next release's notes on GitHub, word for word; earlier releases' notes are on their release pages.

## Unreleased

**Moving from 0.6.0.** Inteligir is now a library of everything you save, in your Inteligir account, which your Mac, your iPhone and inteligir.com/library all show, so it needs a connection. Download this version from inteligir.com (the version you have can't update itself to it; it needs macOS 13.5 or later), sign in or create an account with an invite code, and update every iPhone you use. Nothing on your Mac comes in by itself: zip your notes folder and choose Import a zip of notes… in Settings › Import. Before you zip, open the iPhone app online so what you wrote there has reached your Mac, copy any comment or agent reply you want to keep into its note, and paste what your `AGENTS.md` tells the agent into Settings › Account › Filing rules. An earlier version's formulas, highlights, underlines and toggles, columns or dates written as tags come in as the text they were written as, and your window settings start over once.

### New

- **Your library opens in your browser** at inteligir.com/library, to read, edit, organize, search, undo and ask the agent, every change reaching your other devices as you make it.
- **The Mac app opens your library from inteligir.com**: close the window and click Inteligir in the Dock to bring it back; offline, choose View › Reload once you're back.
- **Your library, one card per item**: All items, Unsorted, a folder or a tag in the sidebar, a kind above the grid, Finder's selection, Space for a quick look, quick with tens of thousands of items.
- **Save a link from the Add menu or ⌘P**, into the folder you're looking at or Unsorted; Add › Add files… adds files the same way.
- **What you save fills itself in, without a model**: title, site, author, cover and readable text, and "Page not read" says why when a page can't be read, with Read the page again to retry.
- **Save from Chrome, Arc, Brave, Edge or Vivaldi** with the Inteligir extension, on your browser's own sign-in to inteligir.com; its Sign in opens inteligir.com's sign-in, and a save made offline or signed out lands later.
- **Pictures and files in a note**: paste or drop one up to 100 MB into a note's text, shown in it on every device.
- **Any file up to 100 MB is an item of its own**, and PDFs, videos and sounds open in the window.
- **An item opens full size**: a file in its viewer, a saved page as its article under Open original, and what you type into a saved page stays your note when it's read again.
- **Info** shows what an item is and where it came from, and moves, tags and pins one or many.
- **Tidy my library** asks the agent to file and tag what's in Unsorted or untagged, following your filing rules in Settings › Account.
- **The built-in agent, on every device**: ⌘K opens it, your conversations are your account's, it asks before deleting or saving a link, New conversation leaves a conversation for the list, and a day allows a couple of answers.
- **Use your library from your own Claude or ChatGPT** by adding `https://inteligir.com/connector` as a connector; Disconnect it in Settings › Account › Connected assistants.
- **Bring your Raindrop bookmarks in** from a Raindrop backup's CSV file, in Settings › Import.
- **Bring a zip of notes in**, a folder of notes or an Obsidian folder, in Settings › Import; what it can't read is counted under "couldn't be read".
- **Your library on your iPhone**: covers, kinds, search, every file, live editing, and what you last opened readable offline.
- **Create your account on your iPhone** with the invite code you were sent.
- **Save from any app on your iPhone** with "Save to Inteligir"; a share made offline waits on the phone and lands once you're back.
- **Ask the agent on your iPhone**, in the same conversations as your Mac and your browser.
- **Photos on your iPhone are pictures of their own**: Add a photo in the library, at most 2048 pixels and with no location.
- **Deleted brings everything back**, an item's files included; Delete forever… and Empty Deleted… remove them for good.
- **Terms of Use**, at inteligir.com/terms.

### Changed

- **The Mac app offers each update in a notice that stays**: Download, then Restart once it's ready; it stacks with other notices and VoiceOver reads each step.
- **The privacy policy reads plainly, each practice stated once**: your library in your account, what each device sends, and how to ask for a copy, a correction or a deletion.
- **Undo takes back what the agent changed, for seven days**, keeping every edit made since; typing inside a paragraph the agent added goes with it, and Undo names each note it happened in.
- **The sidebar chooses what the library shows**: All items, Unsorted, folders, tags and Deleted.
- **The panel's tabs are Info and Agent.**
- **⌘P searches your library and runs a few commands**: New note, Save a link…, Ask the agent, Tidy my library and Settings.
- **Search looks at an item's address, site, author, description and tags**, not inside its properties.
- **Deleting an item on your iPhone moves it to Deleted.**
- **A link to a note is a link to that item**, so renaming or moving it keeps every link, and pointing at one shows its card's preview.
- **`[[Title]]` in an imported note or the agent's writing links the one item with that title**, and stays text when none or several have it.
- **Some formatting doesn't survive markdown**: what the agent reads, the blocks its edit touches and an imported note keep only what markdown can say.
- **HTML in an imported note is its text**, and text indented four spaces is a code block.
- **The agent draws diagrams** as Mermaid in the note.
- **Your devices and the agent edit one note together**, live, and ⌘Z takes back only your own typing.
- **Callouts in the older form come in as their text**; make them a callout from the `/` menu.
- **Embed from URL takes only an https:// or http:// link.**
- **Choosing a new password looks like the rest of the website.**
- **Dragging across the window selects only text you would copy.**
- **Long notes open, scroll and type faster.**
- **Diagrams draw as you type, in the app's own colours.**
- **A very long page keeps its first part.**
- **Signing in on inteligir.com takes you to your library**, or back to the page that sent you.
- **Settings › Account lists every device signed in to your account**, and Sign out beside any ends it at once.
- **A sign-in lasts 60 days from the last time you used it.**
- **You can be signed in on up to 20 devices and browsers at once.**
- **Resetting your password signs you out everywhere.**
- **Signing out in a browser or the Mac app empties the site's cache**, files you opened included.
- **Your iPhone asks for no device name.**
- **A full library takes nothing new**: past about 1 GB it refuses new items and files, and deleting forever frees room.
- **A change your library can't take says why**, and puts it back.
- **A full note says so**: a note holds about 8 MB, and a single paste of more than about 1 MB doesn't go in.
- **A chart that sets height, width, palette or an axis label shows its JSON**; take them out to get the chart back.
- **New note on the Mac starts with no title**, following your first line until you type one.
- **Text you paste that opens with a `---` block comes in as a code block.**
- **The Mac window has the standard title bar.**
- **inteligir.com follows your computer's light or dark mode** until you choose, and its theme switch and Settings › Editor › Theme are one choice.
- **inteligir.com's headings' links are GitHub's.**

### Removed

- **The Devices page on inteligir.com, and Revoke**: use Settings › Account.
- **Working with no connection**: editing, searching, saving from inside the app and the agent need one; only the extension's and the share sheet's saves wait.
- **The sync line at the bottom of the sidebar.**
- **A library in a folder on your Mac**, with Open Vault…, the Files list and the choice of where pasted pictures go.
- **Settings › Connectors and Settings › Advanced**, with syncing to a server of your own and the log.
- **Actions**: the agent's conversations are in the panel's Agent tab.
- **Let my phone ask this Mac.**
- **The capture box on iPhone**: type into Save a link or a thought instead.
- **Raw editing**: every note opens with rich editing.
- **Share with agent, Copy link and Export in a note's ⋯ menu**: ask with ⌘K, and copy a note's text to take it elsewhere.
- **History**: Undo this turn, ⌘Z and Deleted take changes back.
- **Comments**: quote the passage in the note with your words under it.
- **Related and unlinked mentions**: search for a note's name instead.
- **Problems** in ⌘P.
- **Search and replace across the library**: ask the agent, or ⌥⌘F within one note.
- **Embedding another note**: `![[Note]]` comes in as a link.
- **Renaming a tag everywhere**: ask the agent.
- **Daily notes and templates**: ask the agent to start a note from one, or choose Date from the `/` menu.
- **Go to heading**: click a heading in the note's outline.
- **⌘T no longer moves to the title.**
- **The Keyboard shortcuts page and What's new**: each release's notes are on GitHub.
- **Run on an HTML block**: an HTML block shows its preview with its scripts off.
- **The `inteligir` command and `npx inteligir serve`**: use the connector.

### Fixed

- **inteligir.com's pages hold still as they load**: the text no longer jumps when the font arrives, the library's title bar stands before its items do, and a sign-in error no longer moves the form.
- **Password changed says what happened**: every device and browser that was signed in is signed out.
- **Enter at the start of a saved page's paragraph keeps your new line yours**: Read the page again no longer deletes it or repeats the paragraph.
- **Underlined text stays underlined**, though an agent's edit to its paragraph writes it plain.
- **Tabs work inside toggles, columns, callouts, quotes and lists**, and end or start with any block.
- **Typing `md` in the `[[` picker matches titles alone.**
- **An equation keeps the text on its `$$` line.**
- **An empty bullet keeps the list nested under it.**
- **A table cell keeps its second line and its bars.**
- **A link keeps its address through an import and an agent's edit**, punctuation at its end included.
