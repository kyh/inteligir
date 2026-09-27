import { siteConfig } from "@/lib/site-config";

// each page's markdown is its one source: the route renders it as HTML and answers it as-is to an
// agent that negotiates text/markdown, so the two representations cannot drift

const { contact, github, name, url } = siteConfig;

export const homeMarkdown = `# ${name}: the workspace for knowledge work

${name} is a notes app for the Mac where an AI agent edits your notes with you. You write, and
when you ask, the agent reads your notes, drafts, reorganizes and answers from them, editing the
same files you do. Every change it makes is kept in your notes' history, so any of it can be
undone.

## How it works

- **Your notes stay yours.** They are plain markdown files in a folder on your Mac. The app, its
  search and the agent all run on that Mac.
- **The agent runs on the plan you already have.** Sign in with a paid Claude plan or any ChatGPT
  plan; ${name} never bills you for model usage and never asks for an API key.
- **An account is optional.** Without one ${name} is a local notes app that makes no cloud request.
  With one, your notes and conversations sync between your devices, and a hosted copy of your
  notes is kept for your phone and your other Macs.

${name} runs on Macs with Apple silicon and is shared with a small invited group for now.

- [Download for Mac](${github}/releases/latest)
- [About ${name}](${url}/about)
- [Contact](${url}/contact)
- [Privacy](${url}/privacy)
`;

export const aboutMarkdown = `# About ${name}

${name} is a notes app built around one idea: an AI agent should work in your notes the way a
thoughtful collaborator would, in the open, on files you own, with every change reversible. It
is made for knowledge workers (writers, researchers, analysts, operators), not for developers,
and nothing about using it requires a terminal.

## What makes it different

- **Local-first.** Your notes are ordinary markdown files in a folder you choose. They open in
  any other editor, and they keep working if ${name} ever goes away.
- **Your own model plan.** The agent runs on your Mac through your own Claude or ChatGPT sign-in.
  ${name} does not resell model access, has no API-key fallback, and never routes a model call
  through its own servers.
- **History by default.** Every edit, yours or the agent's, is recorded, so you can see what
  changed and take any of it back.
- **Sync when you want it.** An optional account syncs your notes, your conversations with the
  agent and your quick captures across your Macs and your phone. The hosted copy of your notes is
  free up to about 1 GB.

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
the source. Please leave the contents of your notes out of a public issue.

## Elsewhere

Updates are posted on X as [${siteConfig.twitter}](${siteConfig.twitterUrl}).

## Before you write

- **Can't sign in or forgot your password?** The sign-in page can email you a reset link.
- **Want to remove your data?** Deleting your account from the app's settings deletes what the
  cloud holds for it; the [privacy policy](${url}/privacy) explains exactly what that covers.
`;

export const llmsTxt = `# ${name}

> ${name} is a local-first notes app for the Mac in which an AI agent, running on the user's own
> Claude or ChatGPT plan, reads and edits the user's markdown notes alongside them.

${name} stores notes as plain markdown files in a folder on the user's Mac. The app, its search
and the agent run on that Mac; an optional account adds sync across Macs and an iPhone app. It is
open source (MIT), available for Apple silicon Macs, and shared with a small invited group.

## When to use ${name}

- A person wants an AI agent to draft, reorganize, summarize or answer questions from their own
  notes, with every agent edit recorded and reversible.
- A person wants notes as plain markdown files they own on disk, not in a proprietary cloud.
- A person already pays for Claude or ChatGPT and wants that plan, not a separate subscription or
  API key, to power the agent.

## When not to use ${name}

- The person is on Windows, Linux or an Intel Mac.
- The person needs real-time multi-user collaboration on the same document.

## Pages

- [Home](${url}/): what ${name} is and how it works
- [About](${url}/about): principles and who makes it
- [Contact](${url}/contact): email and GitHub
- [Privacy](${url}/privacy): exactly what leaves the user's Mac and what never does

## Optional

- [Download](${github}/releases/latest): the signed macOS build
- [Source code](${github}): the open-source repository
- [Sitemap](${url}/sitemap.xml)
`;

export const notFoundMarkdown = (path: string): string => `# Page not found

Nothing is served at \`${path}\` on ${url}.

- [Home](${url}/)
- [llms.txt](${url}/llms.txt): a summary of ${name} for agents
- [Sitemap](${url}/sitemap.xml): every page on this site
`;

export const SITEMAP_PATHS = ["/", "/about", "/contact", "/privacy"] as const;
