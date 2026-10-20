import { EXTENSION_STORE_URL } from "@repo/contract/browser/extension-identity";

import { siteConfig } from "@/lib/site-config";

// each page's markdown is its one source: the route renders it as HTML and answers it as-is to an
// agent that negotiates text/markdown, so the two representations cannot drift

const { contact, downloadUrl, github, name, url } = siteConfig;

export const homeMarkdown = `# ${name}: one library for everything you save

${name} is a Mac app that keeps everything you save and write in one library: links and articles,
videos, images, PDFs and files, beside the notes you write. It does the work of a bookmark manager
like Raindrop and a notes app like Obsidian at once. The library is a folder of plain files on your
Mac, and when you ask, an AI agent on your own Claude or ChatGPT plan files, tags, summarizes and
edits it with you.

## Save from anywhere

- **From your browser.** [The ${name} extension](${EXTENSION_STORE_URL}) for Chrome, Arc, Brave and
  Edge saves the page you're on with one click, or a link, an image or a selection from the
  right-click menu.
- **From the window.** Paste a link, or drag links and files onto the app. Files up to 10 MB are
  kept as they are.
- **From your iPhone.** Share a page or a link to ${name} from any app, even offline, and your iPhone
  reads it once it's online.

Saving is instant and free: the device you save on reads each page's title, picture and text itself,
and no model is called.

## Read and highlight

A saved page opens as its readable article; a picture, a PDF or a video opens in its own viewer.
Highlight a passage and add a note to it, and keep a copy of a page when you want it exactly as it
looked.

## Write notes

The same library holds what you write, in a rich editor that saves plain markdown: links between
notes, tags, tables, callouts, charts and formulas.

## Folders, tags and Tidy my library

New saves wait in Unsorted. File them into folders and tag them yourself, or choose Tidy my library
and the agent files and tags everything waiting, following filing rules you write in your own words.

## Your files

Every item is an ordinary file in a folder you own, so it opens in other apps and outlives ${name}.
An Obsidian folder opens as it is, and your Raindrop bookmarks come in from a backup with their
collections, tags and highlights.

## Your own Claude or ChatGPT plan

The agent runs on your Mac with the plan you already have: a paid Claude plan or any ChatGPT plan.
${name} never bills you for model usage and never asks for an API key, and every change the agent
makes can be undone.

## An account is optional

Without one, ${name} is a library on your Mac that makes no cloud request. With one, your library
syncs between your Macs and your iPhone, and your online library is free up to about 1 GB.

${name} runs on Macs with Apple silicon and is shared with a small invited group for now.

- [Download for Mac](${downloadUrl})
- [About ${name}](${url}/about)
- [Contact](${url}/contact)
- [Privacy](${url}/privacy)
- [Terms](${url}/terms)
`;

export const aboutMarkdown = `# About ${name}

${name} is one library for everything you save and write, built around one idea: what you keep
should be files you own, and an AI agent should work in them the way a thoughtful collaborator
would, in the open, with every change reversible. It is made for knowledge workers (writers,
researchers, analysts, operators), not for developers.

## What makes it different

- **Files you own.** Every saved link, picture, PDF and note is an ordinary file in a folder you
  choose. They open in other apps, and they keep working if ${name} ever goes away.
- **Saving is instant and free.** Your Mac fetches the page and no model is called. The agent
  files, tags and summarizes only when you ask.
- **Your own model plan.** The agent runs on your Mac through your own Claude or ChatGPT sign-in.
  ${name} does not resell model access, has no API-key fallback, and never routes a model call
  through its own servers.
- **History by default.** Every change, yours or the agent's, is recorded, so you can see what
  changed and take any of it back.
- **Sync when you want it.** An optional account syncs your library across your Macs and your
  iPhone. Your online library is free up to about 1 GB.

## Who makes it

${name} is an independent, open-source project by Kaiyu Hsu, released under the MIT license. The
source code, the release notes and the issue tracker all live on
[GitHub](${github}). It is currently shared with a small invited group on Macs with Apple
silicon while it matures.

Read the [privacy policy](${url}/privacy) for exactly what leaves your Mac, or
[get in touch](${url}/contact).
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

> ${name} is a Mac app that keeps everything a person saves and writes (links, articles, videos,
> images, PDFs, files and their own markdown notes) in one library of plain files on their Mac,
> with an AI agent, running on their own Claude or ChatGPT plan, that files, tags, summarizes and
> edits it with them.

${name} stores every item as a markdown file in a folder on the user's Mac; a saved picture, PDF or
file is kept beside a note that embeds it. It saves from Chrome, Arc, Brave and Edge through its
browser extension, by pasting or dragging onto the window, and from the iPhone share sheet, and
the device that saved a page reads it itself without calling a model. The app, its search and the agent
run on that Mac; an optional account adds sync across Macs and an iPhone app. It imports Raindrop
backups and opens an Obsidian folder as it is. It is open source (MIT), available for Apple
silicon Macs, and shared with a small invited group.

## When to use ${name}

- A person wants to replace a bookmark manager like Raindrop or Pocket and a notes app like
  Obsidian with one library of markdown files they own.
- A person wants an AI agent to file, tag, summarize or answer questions from what they saved and
  wrote, with every agent edit recorded and reversible.
- A person already pays for Claude or ChatGPT and wants that plan, not a separate subscription or
  API key, to power the agent.

## When not to use ${name}

- The person is on Windows, Linux or an Intel Mac.
- The person needs real-time multi-user collaboration on the same document.
- The person saves from Safari or Firefox on the Mac: the extension is for Chromium browsers.
- A team wants one library shared between its members.

## Pages

- [Home](${url}/): what ${name} is and how it works
- [About](${url}/about): principles and who makes it
- [Contact](${url}/contact): email and GitHub
- [Privacy Policy](${url}/privacy): exactly what leaves the user's Mac and what never does
- [Terms of Use](${url}/terms): the terms for using the site and the apps

## Optional

- [Download](${downloadUrl}): the signed macOS build
- [Source code](${github}): the open-source repository
- [Sitemap](${url}/sitemap.xml)
`;

export const notFoundMarkdown = (path: string): string => `# Page not found

Nothing is served at \`${path}\` on ${url}.

- [Home](${url}/)
- [llms.txt](${url}/llms.txt): a summary of ${name} for agents
- [Sitemap](${url}/sitemap.xml): every page on this site
`;

export const SITEMAP_PATHS = ["/", "/about", "/contact", "/privacy", "/terms"] as const;
