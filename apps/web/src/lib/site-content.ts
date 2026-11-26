import { CONNECTOR_PATH } from "@repo/contract/connector";
import { EXTENSION_STORE_URL } from "@repo/contract/extension/extension-identity";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { LEGAL_DOCS } from "#lib/legal-docs";
import { PAGES } from "#lib/page-meta";
import { LICENSES_PATH, siteConfig } from "#lib/site-config";

const { contact, downloadUrl, github, name, url } = siteConfig;
const libraryUrl = `${url}${LIBRARY_PAGE_PATH}`;

export const homeMarkdown = `# ${name}: ${PAGES.home.title}

${name} is a personal workspace for the notes you write, the plans you make and the pages you save
from the web. Pages nest in one tree, lists carry properties and group their notes by status, and
notes are built from rich blocks with markdown underneath, linked to each other and to what you
saved, in a library you can take out whole. It's made for
one person, not a team: no seats, roles or admin panels. Your Mac, your iPhone and a browser all
show it, and a built-in AI agent files, tags and edits it with you when you ask.

## Write

Start a note and shape it with blocks: headings, to-dos, toggles, tables, callouts, columns, tabs,
charts, formulas and diagrams. Link one note to another, or to anything you saved, and a note can
hold notes of its own. Underneath, every note is markdown, so what you write reads the same in
any other app.

## Plan

A list collects notes and groups them by a select, To do, In progress and Done to start, so a list
is a board for a project or a trip. Give it the properties you need, text, link or select, move a
note along as it progresses, and open one beside the list to work in it.

## Save from the web

- **From your browser.** [The ${name} extension](${EXTENSION_STORE_URL}) for Chrome, Arc, Brave and
  Edge saves the page you're on with one click, or a link or an image from the right-click menu.
- **From the window.** Paste a link, or drag links and files onto the app. Any file up to 100 MB is
  kept as it is.
- **From your iPhone.** Share a page or a link to ${name} from any app. It's saved at once and our
  cloud reads the page; shared offline, it waits on your iPhone until you're back online.

A saved page opens as its readable article, with room for your own notes on it; a picture, a PDF
or a video opens in its own viewer. Saving is instant and free, and calls no model: the extension
reads the page you save from it when it can, and our cloud reads every other link.

## One tree for everything

Folders, lists, notes and what you save sit in one tree in the sidebar, the way pages nest in a
workspace. New saves wait in Unsorted. File and tag them yourself, or choose Tidy my library and the
agent files and tags everything waiting, following filing rules you write in your own words.

## The agent is built in

The agent runs in our cloud on Anthropic's Claude, on our account, so you need no plan and we never
ask for an API key. It searches, reads, writes and reorganizes your workspace when you ask, and
each answer that changed something can be undone. Each account gets a free daily allowance. What
the agent reads to answer you goes to Anthropic. What it deletes waits in Deleted, and Undo under
each answer takes its changes back for seven days.

Your own Claude or ChatGPT can reach the same library through the connector, once you allow it.

## On every device

Your library is kept in your account in our cloud, and the Mac app, the iPhone app and
[your library](${libraryUrl}) in a browser each show it whenever you're online. What changes on one
device shows on the others in about a second. Your iPhone keeps what you last opened, so it still
shows with no connection; typing into an open note with no connection is kept on the device and
saves once you're back.

## Bring it in, take it out

A zip of markdown notes comes in with its folders, Raindrop bookmarks come
in from a backup with their collections and tags, and a browser's bookmarks come in from its
exported file with their folders. Export the library at any time: every item as a
markdown file in its folders, with its fields, tags and files, in a zip that imports back as the
same items.

## An account is required

Your first 1 GB is free. Creating an account takes an invite code while ${name} is
shared with a small invited group. The Mac app runs on Macs with Apple silicon.

- [Download for Mac](${downloadUrl})
- [Open your library](${libraryUrl})
- [About ${name}](${url}/about)
- [Contact](${url}/contact)
- [Privacy](${url}/privacy)
- [Terms](${url}/terms)
- [Open-source licenses](${url}${LICENSES_PATH})
`;

export const aboutMarkdown = `# About ${name}

${name} is a personal workspace for notes, plans and what you save from the web, built around one
idea: a tool for one person should have the structure of a team workspace and the feel of a
notebook of your own. Pages nest and lists carry properties; notes are markdown underneath and
link to each other; and an AI agent works in it the way a thoughtful
collaborator would, in the open, with every change it makes reversible. It is made for people who
think for a living (writers, researchers, analysts, operators, founders), not for teams.

## What makes it different

- **Structure without a team's weight.** Folders, lists and notes nest in one tree, a list groups
  its notes by status, and a note is built from rich blocks, with no seats, roles, permissions or
  admin panels to manage.
- **Yours to take out.** Every note is markdown underneath, and Export the library writes every
  item as a markdown file in its folders, which Import reads back as the same items.
- **Saving is part of writing.** A saved page is an item beside your notes, readable as its
  article and linkable from any note. Saving is instant and free: the extension reads the page you
  save from it when it can, our cloud reads it otherwise, and neither calls a model.
- **The agent is built in.** It runs in our cloud on our account with Anthropic, so you need no plan
  and we never ask for an API key. What it reads to answer you goes to Anthropic. Your own Claude or
  ChatGPT can reach the same library through the connector.
- **On every device.** Your Mac, your iPhone and a browser all show the same library, with no sync
  to set up; your iPhone keeps what you last opened, to read with no connection.
- **An account is required, and its first 1 GB is free.** A single file can be up to 100 MB.

## Who makes it

${name} is an independent, open-source project by Kaiyu Hsu, released under the MIT license. The
source code, the release notes and the issue tracker all live on
[GitHub](${github}). It is currently shared with a small invited group while it matures.

Your library is encrypted at rest but not end to end, so we can read what our cloud holds. The
[privacy policy](${url}/privacy) says exactly what each device sends and what our cloud keeps. For
anything else, [get in touch](${url}/contact).
`;

export const contactMarkdown = `# Contact ${name}

${name} is an independent project by Kaiyu Hsu. Here is how to reach him.

## Email

Write to [${contact.email}](mailto:${contact.email}) for anything: questions about the app, an
invite for yourself or your team, feedback, a privacy request, or deleting your account and its
data.

## GitHub

Bugs and feature requests are best filed as
[issues on GitHub](${github}/issues), where you can also follow what is being worked on and read
the source. Please leave the contents of your library out of a public issue.

## Elsewhere

Updates are posted on X as [${siteConfig.twitter}](${siteConfig.twitterUrl}).

## Before you write

- **Can't sign in?** The sign-in page emails you a code; check your spam folder, or send a new one.
- **Want to remove your data?** Deleting your account from the app's settings deletes what the
  cloud holds for it; the [privacy policy](${url}/privacy) explains exactly what that covers.
`;

export const llmsTxt = (appUrl: string) => `# ${name}

> ${name} is a personal workspace for one person's notes, plans and saved pages: pages that nest, lists with properties grouped by status, notes built from rich
> blocks that are markdown underneath, and links, articles, images, PDFs and files saved from the
> web beside them. It is kept in their account and shown on their Mac, their iPhone and in a
> browser, with a built-in AI agent that files, tags, summarizes and edits it with them.

An account is required, and its first 1 GB is free; creating one takes an invite code. The library
is kept in the account, in ${name}'s cloud. A browser tab at ${libraryUrl}, the Mac app's window on
it and the iPhone app show it online, and the iPhone keeps what it last read to show with no
connection; a page saved from the browser extension or the iPhone's share sheet while offline waits
and lands once back online. ${name} saves from Chrome,
Arc, Brave and Edge through its browser extension, by pasting or dragging onto the window, and from
the iPhone share sheet, and keeps any file up to 100 MB. The extension reads the page it saves when
it can, ${name}'s cloud reads it otherwise, and neither calls a model. The agent runs
in that cloud on Anthropic's Claude, on ${name}'s account, within a free daily allowance. A person's
own Claude or ChatGPT can reach the same library through the connector at ${appUrl}${CONNECTOR_PATH}. It imports
Raindrop backups, a browser's exported bookmarks and zips of markdown notes. It is open source (MIT), and shared with a small invited group; the
Mac app is for Apple silicon.

## When to use ${name}

- A person wants one personal place for notes, plans and saved pages, with nested pages, lists
  grouped by status and properties, but without a team's seats and permissions, and with markdown
  underneath and links between notes, but without setting up sync.
- A person wants to replace a bookmark manager like Raindrop or Pocket and a notes app with one
  library on every device they use.
- A person wants an AI agent to file, tag, summarize or answer questions from what they saved and
  wrote, with every agent edit recorded and reversible.
- A person wants that agent built in, with no plan to buy and no API key to manage.
- A person uses Claude or ChatGPT and wants it to search, read and change what they saved.

## When not to use ${name}

- The person wants an app on Windows, Linux, Android or an Intel Mac: there the library is a browser
  tab that needs a connection.
- The person needs what they keep encrypted end to end: ${name} can read what its cloud holds.
- The person needs real-time multi-user collaboration on the same document.
- The person saves from Safari or Firefox on the Mac: the extension is for Chromium browsers.
- A team wants one library shared between its members.

## Pages

- [Home](${url}/): what ${name} is and how it works
- [About](${url}/about): principles and who makes it
- [Contact](${url}/contact): email and GitHub
- [Privacy Policy](${url}/privacy): exactly what each device sends and what the cloud keeps
- [Terms of Use](${url}/terms): the terms for using the site and the apps

## Optional

- [Download](${downloadUrl}): the signed macOS build
- [Your library](${libraryUrl}): the library in a browser tab, after signing in
- [Source code](${github}): the open-source code
- [Sitemap](${url}/sitemap.xml)
`;

export const notFoundMarkdown = (path: string) => `# Page not found

Nothing is served at \`${path}\` on ${url}.

- [Home](${url}/)
- [llms.txt](${url}/llms.txt): a summary of ${name} for agents
- [Sitemap](${url}/sitemap.xml): every page on this site
`;

const PAGE_MARKDOWN: ReadonlyMap<string, string> = new Map([
  [PAGES.home.path, homeMarkdown],
  [PAGES.about.path, aboutMarkdown],
  [PAGES.contact.path, contactMarkdown],
  [PAGES.privacy.path, LEGAL_DOCS.privacy],
  [PAGES.terms.path, LEGAL_DOCS.terms],
]);

export const pageMarkdown = (path: string) => PAGE_MARKDOWN.get(path);

export const SITEMAP_PATHS = [
  PAGES.home,
  PAGES.about,
  PAGES.contact,
  PAGES.privacy,
  PAGES.terms,
].map((page) => page.path);
