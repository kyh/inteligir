import { EXTENSION_STORE_URL } from "@repo/contract/cloud/extension/extension-identity";
import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";
import { PAGES } from "#lib/page-meta";
import { siteConfig } from "#lib/site-config";

// each page's markdown is its one source: the route renders it as HTML and answers it as-is to an
// agent that negotiates text/markdown, so the two representations cannot drift

const { contact, downloadUrl, github, name, url } = siteConfig;
const libraryUrl = `${url}${LIBRARY_PAGE_PATH}`;

export const homeMarkdown = `# ${name}: one library for everything you save

${name} keeps everything you save and write in one library: links and articles, videos, images,
PDFs and files, beside the notes you write. It does the work of a bookmark manager like Raindrop and
a notes app like Obsidian at once. The library lives in your ${name} account, and your Mac and your
iPhone each keep a copy of it. When you ask, the built-in AI agent files, tags, summarizes and edits
it with you.

## Save from anywhere

- **From your browser.** [The ${name} extension](${EXTENSION_STORE_URL}) for Chrome, Arc, Brave and
  Edge saves the page you're on with one click, or a link, an image or a selection from the
  right-click menu.
- **From the window.** Paste a link, or drag links and files onto the app. Any file up to 100 MB is
  kept as it is.
- **From your iPhone.** Share a page or a link to ${name} from any app. It's saved at once, offline
  too, and our cloud reads the page once it reaches your library.

Saving is instant and free, and calls no model. The extension reads the title, picture and text of
the page you save from it when it can, and our cloud reads every other link.

## Read and highlight

A saved page opens as its readable article; a picture, a PDF or a video opens in its own viewer.
Highlight a passage and add a note to it, wherever you saved the page from.

## Write notes

The same library holds what you write, in a rich editor: links between notes, tags, tables,
callouts, charts and formulas.

## Folders, tags and Tidy my library

New saves wait in Unsorted. File them into folders and tag them yourself, or choose Tidy my library
and the agent files and tags everything waiting, following filing rules you write in your own words.

## Your library, on every device

Your library is kept in your account in our cloud, and every Mac and iPhone you sign in on keeps a
copy of every item's text and of each picture, PDF or file you open. That copy opens, reads and
searches with no connection, and what you change goes out when you're back online. In a browser,
[your library](${libraryUrl}) opens whenever you're online.

Export writes everything to a zip whenever you want it, your notes as markdown files beside every
file you saved. Your Raindrop bookmarks come in from a backup with their collections, tags and
highlights, and an Obsidian folder comes in as a zip.

## The agent is built in

The agent runs in our cloud on Anthropic's Claude, on our account, so you need no plan and we never
ask for an API key. Each account gets a free daily allowance. What the agent reads to answer you goes
to Anthropic. It asks before it deletes anything, and Undo under each answer takes its changes back
for seven days.

Your own Claude or ChatGPT can reach the same library through the connector, once you allow it.

## An account is required

Your first 1 GB is free. Creating an account takes an invite code while ${name} is
shared with a small invited group. The Mac app runs on Macs with Apple silicon.

- [Download for Mac](${downloadUrl})
- [Open your library](${libraryUrl})
- [About ${name}](${url}/about)
- [Contact](${url}/contact)
- [Privacy](${url}/privacy)
- [Terms](${url}/terms)
`;

export const aboutMarkdown = `# About ${name}

${name} is one library for everything you save and write, built around one idea: what you keep
should be on every device you use, and an AI agent should work in it the way a thoughtful
collaborator would, in the open, with every change it makes reversible. It is made for knowledge workers
(writers, researchers, analysts, operators), not for developers.

## What makes it different

- **One library on every device.** Every saved link, picture, PDF and note is kept in your account,
  and each Mac and iPhone you sign in on keeps a copy of every item's text and of each file you open,
  which work with no connection. Export writes all of it to a zip whenever you want it.
- **Saving is instant and free.** The extension reads the page you save from it when it can, our
  cloud reads it otherwise, and neither calls a model. The agent files, tags and summarizes only when
  you ask.
- **The agent is built in.** It runs in our cloud on our account with Anthropic, so you need no plan
  and we never ask for an API key. What it reads to answer you goes to Anthropic. Your own Claude or
  ChatGPT can reach the same library through the connector.
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

- **Can't sign in or forgot your password?** The sign-in page can email you a reset link.
- **Want to remove your data?** Deleting your account from the app's settings deletes what the
  cloud holds for it; the [privacy policy](${url}/privacy) explains exactly what that covers.
`;

export const llmsTxt = `# ${name}

> ${name} is a library of everything a person saves and writes (links, articles, videos, images,
> PDFs, files and their own notes), kept in their account and on every Mac and iPhone they sign in
> on, with a built-in AI agent that files, tags, summarizes and edits it with them.

An account is required, and its first 1 GB is free; creating one takes an invite code. The library
is kept in the account, in ${name}'s cloud. Each Mac and iPhone keeps a copy of every item's text and
of each file opened on it, which reads and searches with no connection, and a browser tab at
${libraryUrl} shows it online. ${name} saves from Chrome,
Arc, Brave and Edge through its browser extension, by pasting or dragging onto the window, and from
the iPhone share sheet, and keeps any file up to 100 MB. The extension reads the page it saves when
it can, ${name}'s cloud reads it otherwise, and neither calls a model. The agent runs
in that cloud on Anthropic's Claude, on ${name}'s account, within a free daily allowance. A person's
own Claude or ChatGPT can reach the same library through the connector at ${url}/connector. It imports
Raindrop backups and zips of notes such as an Obsidian folder, and exports the whole library as a
zip of markdown notes and files. It is open source (MIT), and shared with a small invited group; the
Mac app is for Apple silicon.

## When to use ${name}

- A person wants to replace a bookmark manager like Raindrop or Pocket and a notes app like
  Obsidian with one library on every device they use.
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

export const notFoundMarkdown = (path: string): string => `# Page not found

Nothing is served at \`${path}\` on ${url}.

- [Home](${url}/)
- [llms.txt](${url}/llms.txt): a summary of ${name} for agents
- [Sitemap](${url}/sitemap.xml): every page on this site
`;

export const SITEMAP_PATHS = [
  PAGES.home,
  PAGES.about,
  PAGES.contact,
  PAGES.privacy,
  PAGES.terms,
].map((page) => page.path);
