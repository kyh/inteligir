# Changelog

What changed in Inteligir (the Mac app, the iPhone app, the browser extension and inteligir.com), newest first. The top section becomes the next release's notes on GitHub, word for word; earlier releases' notes are on their release pages.

## Unreleased

**Moving from 0.6.0.** Inteligir is now a library of everything you save, in your Inteligir account, which your Mac, your iPhone and inteligir.com/library all show, so it needs a connection. Download this version from inteligir.com (the version you have can't update itself to it; it needs macOS 13.5 or later), sign in or create an account with an invite code, and update every iPhone you use. Nothing on your Mac comes in by itself: zip your notes folder and choose Import a zip of notes… in Settings › Import, keeping the window open until it says what it added. Before you zip, open the iPhone app online so what you wrote there has reached your Mac, copy any comment or agent reply you want to keep into its note, and paste what your `AGENTS.md` tells the agent into Settings › Account › Filing rules. An earlier version's formulas, highlights, underlines and toggles, columns or dates written as tags come in as the text they were written as, and your theme, editor settings, window layout and folded headings start over once.

### New

- **Your library opens in your browser** at inteligir.com/library, to read, edit, organize, search, undo and ask the agent, every change reaching your other devices as you make it.
- **The Mac app opens your library from inteligir.com**: close the window and click Inteligir in the Dock to bring it back; offline, choose View › Reload once you're back.
- **Your library, one card per item**: All items, Unsorted, a folder or a tag in the sidebar, a kind above the grid, Finder's selection, Space for a quick look, quick with tens of thousands of items.
- **Back and Forward walk your library**: a folder, a tag or Deleted is its own place in the window's address, so a reload keeps it and a link opens it; choosing a kind above the grid adds no step to Back.
- **A new window, and the Mac app when it starts, open All items**: choose a folder or a tag in the sidebar to go back to it.
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
- **An import is read on your device**: keep the window open until it says what it added, and if it closes, choose the same file again and it carries on, adding nothing twice.
- **Your library on your iPhone**: covers, kinds, search, every file, live editing, and what you last opened readable offline.
- **Create your account on your iPhone** with the invite code you were sent.
- **Save from any app on your iPhone** with "Save to Inteligir"; a share made offline waits on the phone and lands once you're back.
- **Ask the agent on your iPhone**, in the same conversations as your Mac and your browser.
- **Photos on your iPhone are pictures of their own**: Add a photo in the library, at most 2048 pixels and with no location.
- **Deleted brings everything back**, an item's files included; Delete forever… and Empty Deleted… remove them for good.
- **Ask the agent to add to an item's note** and it writes after what's there, in a saved page, a picture or a PDF with no note yet too; what it adds stays when the page is read again.
- **A link can open an item on its words**: add `find=` and the words to an item's address, and its find bar opens on them.
- **Terms of Use**, at inteligir.com/terms.

### Changed

- **The Mac app offers each update in a notice that stays**: Download, then Restart once it's ready; it stacks with other notices and VoiceOver reads each step.
- **The privacy policy reads plainly, each practice stated once**: your library in your account, what each device sends, and how to ask for a copy, a correction or a deletion.
- **Undo takes back what the agent changed, for seven days**, keeping every edit made since and any you made while it worked, a pin or a new name included; typing inside a paragraph the agent added goes with it, and Undo names each note it happened in.
- **Only the agent's changes are kept for Undo**: what you, a connected assistant or an import change is not, and Undo this turn and Undo this conversation work as before.
- **The sidebar chooses what the library shows**: All items, Unsorted, folders, tags and Deleted.
- **The panel's tabs are Info and Agent.**
- **Info's Add property asks for a name, a type and a value**: Text, Number, Checkbox, Date or List, kept exactly as you typed it, so `Meeting: Q3 review` stays text and `02139` keeps its zero.
- **A date property is picked from a calendar**, and the Text/Date switch under a property's name is gone: to make a date text again, remove the property and add it as Text.
- **A new property can't be named title, tags, folder or pinned**, or take a name the item already has; Add property says so and stays open.
- **⌘P searches your library and runs a few commands**: New note, Save a link…, Ask the agent, Tidy my library and Settings.
- **⌘P shows the words that matched under each result**, wherever they sit in a long paragraph; a connected assistant's search results do too.
- **⌘P says why a search found nothing**: nothing in your library matches, it needs a connection, or the search failed.
- **A saved link fills itself in sooner**: its title, cover and text start arriving as soon as it's saved, up to 5 seconds earlier.
- **A saved link's address is kept the way a browser writes it**: a lowercase site name, `.` and `..` in its path worked out, `/` for an empty path, and an international name in its `xn--` form, which its card shows; two spellings of one international address are one item.
- **Search looks at an item's address, site, author, description and tags**, not inside its properties.
- **Deleting an item on your iPhone moves it to Deleted.**
- **A link to a note is a link to that item**, so renaming or moving it keeps every link, and pointing at one shows its card's preview.
- **`[[Title]]` in an imported note or the agent's writing links the one item with that title**, and stays text when none or several have it.
- **Some formatting doesn't survive markdown**: what the agent reads, the blocks its edit touches and an imported note keep only what markdown can say.
- **The agent and connected assistants leave a saved page's article as it was read**: ask for the change in the item's note.
- **A note the agent or a connected assistant creates takes its title and tags only from what you ask for**: a `---` block at the top of its text stays in the note as a code block, as one at the top of a note saved with a link does.
- **HTML in an imported note is its text**, and text indented four spaces is a code block.
- **The agent draws diagrams** as Mermaid in the note.
- **The agent's question says exactly which items it would move to Deleted, or the whole address it would save**, and a request it couldn't carry out is turned down without asking you.
- **Your devices and the agent edit one note together**, live, and ⌘Z takes back only your own typing.
- **Callouts in the older form come in as their text**; make them a callout from the `/` menu.
- **A callout shows its label, never its `[!NOTE]` marker**, with the caret in it or not: click the label to make it a Tip, Important, Warning or Caution (retyping the marker no longer changes it), and type `[!TIP]` where a quote opens to make one.
- **A callout written `[!note]`, or with words on its marker's line, is saved as `[!NOTE]` on a line of its own**; what it says is unchanged.
- **Embed from URL takes only an https:// or http:// link.**
- **Link on words that are already a link changes its address** instead of putting a second link inside it, and lands only on the words you selected: if the note changed while the link field was open, nothing is linked and you're asked to select the text again.
- **Escape in the link field takes you back to your note**, and the toolbar is hidden while a note can't be edited.
- **Blockquote is called Quote** in the `/` menu and on the iPhone's toolbar, as the toolbar's block type already was.
- **A note with pictures or recordings opens sooner** on your Mac and in your browser: a picture loads as you scroll near it, and a recording plays and seeks before it has fully downloaded.
- **A folded heading is folded in every window showing its note.**
- **Choosing a new password looks like the rest of the website.**
- **Dragging across the window selects only text you would copy.**
- **Long notes open, scroll and type faster.**
- **Diagrams draw as you type, in the app's own colours.**
- **A very long page keeps its first part.**
- **Signing in on inteligir.com takes you to your library**, or back to the page that sent you.
- **Opening your library signed out goes straight to sign-in**, before any of it loads, and sign-in and sign-up show at once, taking you straight to your library when you're already signed in.
- **Back and Forward ask before you lose what you typed with no connection**, as closing the item and the tab do: Stay keeps the item open, and a folder or tag you pressed in the sidebar is chosen only once you leave.
- **Settings › Account lists every device signed in to your account**, and Sign out beside any ends it at once.
- **A sign-in lasts 60 days from the last time you used it.**
- **You can be signed in on up to 20 devices and browsers at once.**
- **Resetting your password signs you out everywhere.**
- **Signing out in a browser or the Mac app empties the site's cache**, files you opened included.
- **Your iPhone asks for no device name.**
- **Back on your iPhone leaves a note at once** unless you typed in it or added a file this visit, and the edge swipe goes back the same way.
- **On your iPhone, Send, Approve, Cancel and Stop in a conversation with the agent say "Needs a connection" when you're offline**, instead of going through later: try again once you're back online.
- **A conversation on your iPhone loads only what is new** while the agent works, and Ask the agent lists every conversation at once.
- **A full library takes nothing new**: past about 1 GB it refuses new items and files, and deleting forever frees room.
- **A change your library can't take says why**, and puts it back.
- **Pin, Unpin and Restore from the grid's menu say how many items they changed**, and a restore names every item that stayed in Deleted because another item has its address.
- **Adding files shows its progress from the first one**, "Adding 3 of 12…", as saving several links does, with Stop only while any are left.
- **A link or file that couldn't be saved says why**, and what was saved before it is counted: "Stopped after 2 of 5."
- **A connection that died without closing is noticed sooner**: your Mac, browser or iPhone connects again after 45 seconds without an answer, where it waited 90.
- **A full note says so**: a note holds about 8 MB, and a single paste of more than about 1 MB doesn't go in.
- **A chart that sets height, width, palette or an axis label shows its JSON**; take them out to get the chart back.
- **A chart, canvas or HTML block edits its JSON or source from Edit payload in its header**: the chart grid's Raw JSON link is gone, and an HTML block's Edit is now Edit payload.
- **New note on the Mac starts with no title**, following your first line until you type one.
- **Text you paste that opens with a `---` block comes in as a code block.**
- **The Mac window has the standard title bar.**
- **inteligir.com follows your computer's light or dark mode** until you choose, and its theme switch and Settings › Editor › Theme are one choice.
- **A theme, an editor setting or spell check changed in one window reaches every other open window at once.**
- **The sidebar opens the way you left it**: collapse it and it opens collapsed the next time, as the panel does.
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
- **PDFs preview in Chrome, Arc, Brave and Edge**, where they showed an empty box and a Download button.
- **A callout from the / menu takes what you type**, under its Note label, instead of the line above, and shows no raw `[!NOTE]`.
- **Enter on a link pasted into ⌘P saves it**, ahead of any items its words match.
- **Sign in stays busy until your library opens**, and Back no longer returns to the form you just sent.
- **The agent's reply stays on screen as it lands**: its text no longer blinks at the end of each message, and the conversation follows the reply as it is written until you scroll up.
- **Approve and Cancel stay held while your answer to the agent is on its way**, when it asks before deleting or saving a link, and come back if it couldn't be sent, instead of reading Answered.
- **A finished step in the agent's work no longer draws an empty bar**, and only a failed step opens to say why.
- **The agent's edit of one line leaves the rest of the note as it was**: an underline or a picture's size beside a list that holds a code block or a picture is no longer dropped.
- **The agent reads a long item a part at a time**, so a long saved page with a picture in a list can be read.
- **A note that opens with a callout is titled and found by its words**, not `[!NOTE]`.
- **An item no longer shows twice in your iPhone's library** when the library changed as you scrolled.
- **Every page prints light, even in the dark theme**: the site, the extension's pages and the phone's editor page, and the library's window no longer turns light behind the print dialog.
- **Underlined text stays underlined**, though an agent's edit to its paragraph writes it plain.
- **Tabs work inside toggles, columns, callouts, quotes and lists**, and end or start with any block.
- **Typing `md` in the `[[` picker matches titles alone.**
- **An equation keeps the text on its `$$` line.**
- **An empty bullet keeps the list nested under it.**
- **A table cell keeps its second line and its bars.**
- **A link keeps its address through an import and an agent's edit**, punctuation at its end included.
- **A note that can't take edits can't be changed through its blocks either**: offline, full or in Deleted, a chart, canvas, HTML block, tab, table or formula takes no edit, and their editing buttons stay hidden until it can.
- **An item brought back from Deleted opens editable again**, by Undo, by Undo this turn after the agent deleted it, or by an import, instead of staying read-only under "This item is in Deleted".
- **A page saved or read just as its note first opens is saved** instead of failing.
- **A folded heading stays folded when you rename it**, and a fold no longer jumps to another heading with the same words.
- **Leaving a note with the `/`, `[[` or `{{` menu open no longer leaves its character behind** in the note on your other devices.
- **A note waiting for a connection shows its outline beside its text** on your Mac and in your browser, as an open note does.
- **Enter in an open item's title keeps the cursor in the field**, and a title changed on another device no longer replaces the one you're typing.
- **A delete that stops partway still offers Undo**, which brings back the items that went to Deleted.
